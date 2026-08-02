export type SourceRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type ImportInfo = {
  module: string;
  names: string[];
  defaultName?: string;
  namespaceName?: string;
};

export type CoreImportFix = {
  before: string;
  after: string;
};

export type SourceAnalysis = {
  parser: "typescript" | "fallback";
  parseDiagnostics: Array<{ message: string; line?: number; sourceRange?: SourceRange }>;
  imports: ImportInfo[];
  exports: string[];
  hasDefaultExport: boolean;
  defineRoutePageArg?: string;
  defineRoutePageCallText?: string;
  defineRoutePageLine?: number;
  hasPageLoadContextReference: boolean;
  hasPageLoadContextImport: boolean;
  coreImportFix?: CoreImportFix;
  loadLine?: number;
  browserApiInLoadLine?: number;
  reactApiLine?: number;
  topLevelThrowLine?: number;
};

type TsModule = typeof import("typescript");

function lineOf(source: string, offset: number): number {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function lineRange(source: string, start: number, end: number): SourceRange {
  const beforeStart = source.slice(0, Math.max(0, start)).split(/\r?\n/);
  const beforeEnd = source.slice(0, Math.max(0, end)).split(/\r?\n/);
  return {
    startLine: beforeStart.length,
    startColumn: beforeStart[beforeStart.length - 1].length + 1,
    endLine: beforeEnd.length,
    endColumn: beforeEnd[beforeEnd.length - 1].length + 1
  };
}

function findLine(source: string, pattern: RegExp | string): number | undefined {
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (typeof pattern === "string" ? lines[index].includes(pattern) : pattern.test(lines[index])) {
      return index + 1;
    }
  }
  return undefined;
}

function findCoreImportWithPageLoadContext(source: string): CoreImportFix | undefined {
  const match = source.match(/import\s*{\s*([^}]*?)\s*}\s*from\s*["'](@tavojs\/core(?:\/router)?)["'];?/s);
  if (!match || match[1].includes("PageLoadContext")) {
    return undefined;
  }
  const names = match[1].split(",").map((name) => name.trim()).filter(Boolean);
  const valueImports = names.filter((name) => !name.startsWith("type "));
  const typeImports = names.filter((name) => name.startsWith("type "));
  const nextNames = [...valueImports, ...typeImports, "type PageLoadContext"];
  return {
    before: match[0],
    after: `import { ${nextNames.join(", ")} } from "${match[2]}";`
  };
}

function analyzeWithFallback(source: string): SourceAnalysis {
  const coreImportFix = findCoreImportWithPageLoadContext(source);
  const defineRoutePageMatch = source.match(/defineRoutePage(?:<[^>]+>)?\(\s*["'`]([^"'`]+)["'`]/);
  const defineRoutePageCallText = source.match(/defineRoutePage(?:<[^>]+>)?\(\s*["'`][^"'`]+["'`]/)?.[0];
  const exports = Array.from(source.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)).map((match) => match[1]);
  if (/\bexport\s+default\b/.test(source)) {
    exports.push("default");
  }
  return {
    parser: "fallback",
    parseDiagnostics: [],
    imports: Array.from(source.matchAll(/import\s+(?:[^"']+?)\s+from\s+["']([^"']+)["']/g)).map((match) => ({
      module: match[1],
      names: []
    })),
    exports,
    hasDefaultExport: /\bexport\s+default\b/.test(source),
    defineRoutePageArg: defineRoutePageMatch?.[1],
    defineRoutePageCallText,
    defineRoutePageLine: findLine(source, "defineRoutePage"),
    hasPageLoadContextReference: /\bPageLoadContext\b/.test(source),
    hasPageLoadContextImport: /import\s*{[^}]*\bPageLoadContext\b[^}]*}\s*from\s*["']@tavojs\/core(?:\/router)?["']/.test(source),
    coreImportFix,
    loadLine: findLine(source, /\bfunction\s+load\b|\bconst\s+load\s*=|load\s*:/),
    browserApiInLoadLine: /\bfunction\s+load\b|\bconst\s+load\s*=|load\s*:/.test(source) && /\b(window|document|localStorage|sessionStorage|navigator)\b/.test(source)
      ? findLine(source, /\b(window|document|localStorage|sessionStorage|navigator)\b/)
      : undefined,
    reactApiLine: findLine(source, /from\s*["']react["']|use(State|Effect|Memo|Callback|Ref|Reducer)\s*\(/),
    topLevelThrowLine: findLine(source, /^\s*throw\s+/)
  };
}

async function loadTypescript(): Promise<TsModule | null> {
  try {
    return await import("typescript");
  } catch {
    return null;
  }
}

function hasExportModifier(ts: TsModule, node: import("typescript").Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as import("typescript").Declaration) & ts.ModifierFlags.Export);
}

function hasDefaultModifier(ts: TsModule, node: import("typescript").Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as import("typescript").Declaration) & ts.ModifierFlags.Default);
}

function nodeContainsBrowserApi(ts: TsModule, node: import("typescript").Node): boolean {
  let found = false;
  const browserNames = new Set(["window", "document", "localStorage", "sessionStorage", "navigator"]);
  const visit = (child: import("typescript").Node) => {
    if (found) {
      return;
    }
    if (ts.isIdentifier(child) && browserNames.has(child.text)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export async function analyzeSource(fileName: string, source: string): Promise<SourceAnalysis> {
  const ts = await loadTypescript();
  if (!ts) {
    return analyzeWithFallback(source);
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const analysis = analyzeWithFallback(source);
  analysis.parser = "typescript";
  const parseDiagnostics = (sourceFile as import("typescript").SourceFile & { parseDiagnostics?: import("typescript").DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  analysis.parseDiagnostics = parseDiagnostics.map((diagnostic: import("typescript").DiagnosticWithLocation) => {
    const start = diagnostic.start ?? 0;
    const end = start + (diagnostic.length ?? 0);
    return {
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line: lineOf(source, start),
      sourceRange: lineRange(source, start, end)
    };
  });
  analysis.imports = [];
  analysis.exports = [];
  analysis.hasDefaultExport = false;
  analysis.defineRoutePageArg = undefined;
  analysis.defineRoutePageCallText = undefined;
  analysis.defineRoutePageLine = undefined;
  analysis.loadLine = undefined;
  analysis.browserApiInLoadLine = undefined;
  analysis.reactApiLine = undefined;
  analysis.topLevelThrowLine = undefined;

  const visit = (node: import("typescript").Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const info: ImportInfo = {
        module: node.moduleSpecifier.text,
        names: []
      };
      if (clause?.name) {
        info.defaultName = clause.name.text;
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        info.namespaceName = clause.namedBindings.name.text;
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        info.names = clause.namedBindings.elements.map((element) => {
          const importedName = element.propertyName?.text ?? element.name.text;
          return element.isTypeOnly ? `type ${importedName}` : importedName;
        });
      }
      analysis.imports.push(info);
      if (info.module === "react") {
        analysis.reactApiLine ??= lineOf(source, node.getStart(sourceFile));
      }
    }

    if (ts.isExportAssignment(node)) {
      analysis.hasDefaultExport = true;
      analysis.exports.push("default");
    }

    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node)) && hasExportModifier(ts, node)) {
      if (hasDefaultModifier(ts, node)) {
        analysis.hasDefaultExport = true;
        analysis.exports.push("default");
      }
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
        if (node.name) {
          analysis.exports.push(node.name.text);
        }
        if (ts.isFunctionDeclaration(node) && node.name?.text === "load") {
          analysis.loadLine = lineOf(source, node.getStart(sourceFile));
          if (nodeContainsBrowserApi(ts, node)) {
            analysis.browserApiInLoadLine = analysis.loadLine;
          }
        }
      } else {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            analysis.exports.push(declaration.name.text);
            if (declaration.name.text === "load") {
              analysis.loadLine = lineOf(source, declaration.getStart(sourceFile));
              if (declaration.initializer && nodeContainsBrowserApi(ts, declaration.initializer)) {
                analysis.browserApiInLoadLine = analysis.loadLine;
              }
            }
          }
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "defineRoutePage") {
        analysis.defineRoutePageLine = lineOf(source, node.expression.getStart(sourceFile));
        analysis.defineRoutePageCallText = source.slice(node.expression.getStart(sourceFile), node.arguments[0]?.end ?? node.expression.end);
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteralLike(firstArg)) {
          analysis.defineRoutePageArg = firstArg.text;
        }
      }
      if (/^use(State|Effect|Memo|Callback|Ref|Reducer)$/.test(node.expression.text)) {
        analysis.reactApiLine ??= lineOf(source, node.expression.getStart(sourceFile));
      }
    }

    if (ts.isThrowStatement(node) && node.parent === sourceFile) {
      analysis.topLevelThrowLine = lineOf(source, node.getStart(sourceFile));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  analysis.exports = Array.from(new Set(analysis.exports));
  analysis.hasPageLoadContextImport = analysis.imports.some((item) =>
    (item.module === "@tavojs/core" || item.module === "@tavojs/core/router") &&
    item.names.some((name) => name === "PageLoadContext" || name === "type PageLoadContext")
  );
  analysis.coreImportFix = findCoreImportWithPageLoadContext(source);
  return analysis;
}
