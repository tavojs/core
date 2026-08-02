import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.cwd();
const errors = [];
const errorSet = new Set();
const scriptExtensions = /\.(?:[cm]?[jt]sx?)$/;
const markdownFiles = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "packages/core/README.md",
  "packages/cli/README.md",
  ...(await collectFiles(path.join(root, "docs"), (file) => file.endsWith(".md"))),
  ...(await collectOptionalFiles(path.join(root, "handover"), (file) => file.endsWith(".md"))),
  ...(await collectFiles(path.join(root, ".changeset"), (file) => file.endsWith(".md")))
].map((file) => path.resolve(root, file));
const contractFiles = [
  ...markdownFiles,
  ...(await collectFiles(path.join(root, "docs"), (file) => file.endsWith(".json"))),
  ...(await collectFiles(path.join(root, "packages/cli"), (file) => file.endsWith(".json"))),
  ...(await collectFiles(path.join(root, "packages/core/src"), (file) => scriptExtensions.test(file))),
  ...(await collectFiles(path.join(root, "packages/cli/src"), (file) => scriptExtensions.test(file))),
  ...(await collectFiles(path.join(root, "preview/src"), () => true)),
  "preview/index.html",
  "preview/package.json",
  "preview/server.mjs",
  "preview/tavo.config.ts",
  "preview/tsconfig.json",
  "preview/vite.config.js"
].map((file) => path.resolve(root, file));

function addError(error) {
  if (errorSet.has(error)) return;
  errorSet.add(error);
  errors.push(error);
}

function normalizedFile(file) {
  return path.resolve(file);
}

function codeLocation(sourceFile, position = 0) {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return `${location.line + 1}:${location.character + 1}`;
}

function markdownLineAt(markdown, position) {
  return markdown.slice(0, position).split(/\r?\n/).length;
}

function isExternalTarget(target) {
  return (
    !target ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function markdownTarget(value) {
  const target = value.trim();
  if (target.startsWith("<")) {
    const closing = target.indexOf(">");
    return closing === -1 ? target : target.slice(1, closing);
  }
  return target.split(/\s+(?=["'(])/u, 1)[0];
}

function referenceId(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unresolvedModule(diagnostic) {
  if (diagnostic.code !== 2307) return undefined;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return /Cannot find module ['"]([^'"]+)['"]/.exec(message)?.[1];
}

function shouldReportTypeDiagnostic(diagnostic, virtualFiles) {
  if (!diagnostic.file || !virtualFiles.has(normalizedFile(diagnostic.file.fileName))) {
    return false;
  }
  // Documentation fragments may deliberately omit local application helpers. Imports from
  // the built Tavo package, assignability, strict callback types, and nullability still fail.
  if (diagnostic.code === 2304 || diagnostic.code === 18004) return false;
  const moduleName = unresolvedModule(diagnostic);
  if (
    moduleName
    && !moduleName.startsWith("@tavojs/core")
    && !moduleName.startsWith("@tavojs/cli")
  ) {
    return false;
  }
  return true;
}

async function verifyLocalTarget(file, rawTarget) {
  const target = markdownTarget(rawTarget);
  if (isExternalTarget(target)) return;
  const [pathAndQuery, rawAnchor = ""] = target.split("#", 2);
  const rawPath = pathAndQuery.split("?", 1)[0];
  let decodedPath;
  let decodedAnchor;
  try {
    decodedPath = decodeURIComponent(rawPath);
    decodedAnchor = decodeURIComponent(rawAnchor);
  } catch {
    addError(`${relative(file)}: invalid URL encoding in local link ${target}`);
    return;
  }
  const targetFile = rawPath
    ? path.resolve(path.dirname(file), decodedPath)
    : file;
  try {
    const stat = await fs.stat(targetFile);
    if (stat.isDirectory() || !decodedAnchor) return;
    const targetMarkdown = markdownByFile.get(targetFile) ?? await fs.readFile(targetFile, "utf8");
    if (!headingAnchors(targetMarkdown).has(decodedAnchor)) {
      addError(`${relative(file)}: missing anchor #${rawAnchor} in ${relative(targetFile)}`);
    }
  } catch {
    addError(`${relative(file)}: missing local link target ${target}`);
  }
}

async function collectFiles(directory, include) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(target, include));
    else if (include(target)) files.push(path.relative(root, target));
  }
  return files.sort();
}

async function collectOptionalFiles(directory, include) {
  try {
    return await collectFiles(directory, include);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function relative(file) {
  return path.relative(root, file);
}

function withoutFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

function githubSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of withoutFences(markdown).split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[2]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of withoutFences(markdown).matchAll(
    /<(?:a|[a-z][a-z0-9-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/gi
  )) {
    anchors.add(match[1]);
  }
  return anchors;
}

const markdownByFile = new Map();
for (const file of markdownFiles) {
  markdownByFile.set(file, await fs.readFile(file, "utf8"));
}

for (const [file, markdown] of markdownByFile) {
  const source = withoutFences(markdown);
  for (const match of source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    await verifyLocalTarget(file, match[1]);
  }

  const definitions = new Map();
  for (const match of source.matchAll(
    /^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/gm
  )) {
    definitions.set(referenceId(match[1]), match[2]);
    await verifyLocalTarget(file, match[2]);
  }
  for (const match of source.matchAll(/!?\[([^\]]+)]\[([^\]]*)]/g)) {
    const id = referenceId(match[2] || match[1]);
    if (!definitions.has(id)) {
      addError(`${relative(file)}: missing Markdown reference definition [${id}]`);
    }
  }

  for (const match of source.matchAll(
    /<(?:a|img|script|link|source|video|audio)\b[^>]*\b(?:href|src)=["']([^"']+)["'][^>]*>/gi
  )) {
    await verifyLocalTarget(file, match[1]);
  }

  const fences = markdown.matchAll(/```(typescript|javascript|tsx|jsx|ts|js|mts|mjs)\s*\n([\s\S]*?)```/g);
  for (const fence of fences) {
    const language = fence[1];
    const scriptKind = language.includes("x")
      ? ts.ScriptKind.TSX
      : language.startsWith("j") || language === "mjs"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      `${relative(file)}.${language}`,
      fence[2],
      ts.ScriptTarget.ESNext,
      false,
      scriptKind
    );
    for (const diagnostic of sourceFile.parseDiagnostics) {
      addError(
        `${relative(file)}: code fence ${language}:${codeLocation(sourceFile, diagnostic.start)} ${
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
        }`
      );
    }
    if (language === "javascript" || language === "jsx" || language === "js" || language === "mjs") {
      const result = ts.transpileModule(fence[2], {
        fileName: `example.${language === "jsx" ? "jsx" : "js"}`,
        reportDiagnostics: true,
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          ...(language === "jsx" ? { jsx: ts.JsxEmit.Preserve } : {}),
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext
        }
      });
      for (const diagnostic of result.diagnostics ?? []) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        const location = diagnostic.file
          ? codeLocation(diagnostic.file, diagnostic.start)
          : "1:1";
        addError(
          `${relative(file)}: code fence ${language}:${location} ${
            ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
          }`
        );
      }
    }
  }
}

const virtualTypeScriptFiles = new Map();
const virtualTypeScriptMetadata = new Map();
let exampleIndex = 0;
for (const [file, markdown] of markdownByFile) {
  for (const fence of markdown.matchAll(/```(typescript|tsx|ts|mts)\s*\n([\s\S]*?)```/g)) {
    const code = fence[2];
    // A fence with an import or export represents a module contract. Expression fragments
    // remain syntax-checked above because their surrounding application context is omitted.
    if (!/(?:^|\n)\s*(?:import|export)\s/m.test(code)) continue;
    const extension = fence[1] === "tsx" ? ".tsx" : fence[1] === "mts" ? ".mts" : ".ts";
    const virtualFile = path.join(
      path.dirname(file),
      `.tavo-doc-example-${exampleIndex}${extension}`
    );
    exampleIndex += 1;
    virtualTypeScriptFiles.set(normalizedFile(virtualFile), `${code}\nexport {};\n`);
    virtualTypeScriptMetadata.set(normalizedFile(virtualFile), {
      file,
      language: fence[1],
      markdownCodeLine: markdownLineAt(markdown, fence.index ?? 0) + 1
    });
  }
}

const compilerOptions = {
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "@tavojs/core",
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: ["node"]
};
const defaultCompilerHost = ts.createCompilerHost(compilerOptions);
const compilerHost = {
  ...defaultCompilerHost,
  fileExists(file) {
    return virtualTypeScriptFiles.has(normalizedFile(file)) || defaultCompilerHost.fileExists(file);
  },
  readFile(file) {
    return virtualTypeScriptFiles.get(normalizedFile(file)) ?? defaultCompilerHost.readFile(file);
  },
  getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile) {
    const source = virtualTypeScriptFiles.get(normalizedFile(file));
    if (source !== undefined) {
      const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      return ts.createSourceFile(file, source, languageVersion, true, scriptKind);
    }
    return defaultCompilerHost.getSourceFile(
      file,
      languageVersion,
      onError,
      shouldCreateNewSourceFile
    );
  }
};
const documentationProgram = ts.createProgram(
  Array.from(virtualTypeScriptFiles.keys()),
  compilerOptions,
  compilerHost
);
for (const diagnostic of ts.getPreEmitDiagnostics(documentationProgram)) {
  if (!shouldReportTypeDiagnostic(diagnostic, virtualTypeScriptFiles)) continue;
  const metadata = virtualTypeScriptMetadata.get(normalizedFile(diagnostic.file.fileName));
  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  addError(
    `${relative(metadata.file)}:${metadata.markdownCodeLine + location.line}:${
      location.character + 1
    } code fence ${metadata.language} TS${diagnostic.code}: ${
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
    }`
  );
}

const forbidden = [
  { pattern: /https?:\/\/(?:www\.)?tavo\.dev\b/i, description: "retired tavo.dev domain" },
  { pattern: /\bdefinePage\s*\(/, description: "removed definePage helper" },
  { pattern: /\bdefineLayout\s*\(/, description: "removed defineLayout helper" },
  { pattern: /\bexport\s+const\s+static\b/, description: "illegal static binding; use prerender" },
  { pattern: /\bssr\s*:\s*false\b/, description: "removed ssr:false alias; use render:\"csr\"" },
  { pattern: /\bPlugin API v2\b/i, description: "migration-era Plugin API v2 name" },
  { pattern: /\bplugins-v2\b/i, description: "migration-era plugin documentation path" },
  { pattern: /\bapiVersion\s*:\s*2\b/, description: "obsolete plugin API version" },
  {
    pattern: /\b(?:aws|lambda|cloudflare|vercel)\b/i,
    description: "provider-specific deployment contract"
  },
  { pattern: /\bdeploy-info\b|\bgenerate deployment\b/i, description: "removed deployment command" },
  { pattern: /\bauto-pages-options\b/i, description: "removed secondary config module" },
  { pattern: /\bimport\s+["']server-only["']/, description: "removed bare server-only alias" },
  {
    pattern: /\b(?:renderAppToString|useStyle)\b/,
    description: "removed compatibility alias"
  },
  {
    pattern: /\bAutoPagesBootstrap\w*\b/,
    description: "removed public AutoPages bootstrap alias",
    allow(file) {
      return relative(file).startsWith("packages/core/src/auto-pages/");
    }
  },
  {
    pattern: /\bchangedFiles\b/,
    description: "removed receipt-level changedFiles field",
    allow(file) {
      return relative(file) === "packages/cli/src/cli/commands/change/preflight.mts";
    }
  },
  {
    pattern: /\bcreateFetchRequestHandler\b|\bcreateImageRequestHandler\b/,
    description: "public internal request handler",
    allow(file) {
      return relative(file) === "packages/core/src/ssr/handlers.ts";
    }
  },
  { pattern: /\bunsafeHtml\b/, description: "raw HTML field must be named unsafeHeadHtml" },
  {
    pattern: /\bhead\s*:\s*`/,
    description: "raw head result must use unsafeHeadHtml",
    allow(file) {
      return relative(file) === "packages/core/src/server.ts";
    }
  },
  {
    pattern: /@deprecated\b/i,
    description: "active deprecated API marker"
  },
  {
    pattern: /\bNode(?:\.js)?\s+18\s+or\s+(?:newer|later)\b|\brequires?\s+Node(?:\.js)?\s+18\b/i,
    description: "obsolete Node 18 requirement"
  },
  {
    pattern: /\bpre-?1\.0\b|\bprelaunch\b|\bprivate preview\b|\bcoming (?:soon|later)\b|\broadmap\b|\bbefore the first release\b|\brelease preparation\b/i,
    description: "prelaunch marker"
  }
];
for (const file of contractFiles) {
  const source = markdownByFile.get(file) ?? await fs.readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(source) && !rule.allow?.(file, source)) {
      addError(`${relative(file)}: contains ${rule.description}`);
    }
  }
}

const allowedCoreSubpaths = new Set([
  "config",
  "dev",
  "jsx-dev-runtime",
  "jsx-runtime",
  "plugin",
  "router",
  "server",
  "server-only",
]);
for (const file of contractFiles) {
  const source = markdownByFile.get(file) ?? await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/@tavojs\/core\/([a-z][\w-]*)/gi)) {
    const subpath = match[1];
    if (
      !allowedCoreSubpaths.has(subpath)
      && relative(file) !== "packages/core/src/framework/not-found.ts"
    ) {
      addError(
        `${relative(file)}: references removed @tavojs/core/${subpath} entrypoint`,
      );
    }
  }
}

for (const script of [
  "scripts/generate-api-reference.mjs",
  "scripts/generate-agent-api-cards.mjs",
  "scripts/generate-agent-protocol-docs.mjs"
]) {
  const result = spawnSync(process.execPath, [script, "--check"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    errors.push(`${script}: ${result.stderr.trim() || result.stdout.trim() || "freshness check failed"}`);
  }
}

if (errors.length > 0) {
  console.error(`Documentation verification failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation verification passed (${markdownFiles.length} Markdown files).`);
}
