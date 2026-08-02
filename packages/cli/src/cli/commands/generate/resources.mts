import path from "node:path";
import {
  firstRouteParamName,
  resolveNamedFolderTarget,
  resolvePageTarget,
  routePatternFromName,
  validateStoreShape
} from "../../generate/targets.mjs";
import { readPagesDirFromConfig } from "../../project/config.mjs";
import type { GeneratorOptions } from "../../types.mjs";
import { ensureDir, writeFileSafe } from "../../utils/fs.mjs";
import { toCamelCase, toPascalCase } from "../../utils/format.mjs";
import { normalizeGeneratorName } from "../../utils/path.mjs";

async function pagesDirectory(): Promise<string> {
  const rootDir = process.cwd();
  return path.resolve(rootDir, await readPagesDirFromConfig(rootDir));
}

export async function generatePage(
  name: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const pagesDir = await pagesDirectory();
  await ensureDir(pagesDir);
  const { target, componentName } = resolvePageTarget(pagesDir, name);
  const title = componentName.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const routePattern = routePatternFromName(name);
  const firstParamName = firstRouteParamName(routePattern);
  const routerImports = [
    ...(options.typedRoute ? ["defineRoutePage"] : []),
    ...(options.loader && firstParamName ? ["type PageLoadContext"] : [])
  ];
  const imports = [
    ...(options.seo ? ['import { Seo } from "@tavojs/core";'] : []),
    ...(routerImports.length > 0
      ? [`import { ${routerImports.join(", ")} } from "@tavojs/core/router";`]
      : []),
  ];
  const componentExport = options.typedRoute
    ? "function"
    : "export default function";
  const componentProps = options.loader
    ? "{ data }: { data?: PageData }"
    : "";
  const lines = [
    ...(imports.length > 0 ? [...imports, ""] : []),
    ...(options.loader ? [
      "type PageData = {",
      "  title: string;",
      "};",
      "",
      `export async function load(${firstParamName ? "{ params }: PageLoadContext" : ""})` +
        ": Promise<PageData> {",
      firstParamName
        ? `  return { title: \`${title} \${params.${firstParamName}}\` };`
        : `  return { title: ${JSON.stringify(title)} };`,
      "}",
      ""
    ] : []),
    `export const head = ${options.seo
      ? `<Seo title=${JSON.stringify(title)} description=${JSON.stringify(`${title} page`)} />`
      : `<title>${title}</title>`};`,
    "",
    `${componentExport} ${componentName}(${componentProps}) {`,
    "  return (",
    "    <main>",
    `      <h1>${options.loader
      ? "{data?.title ?? " + JSON.stringify(title) + "}"
      : title}</h1>`,
    "    </main>",
    "  );",
    "}",
    ...(options.typedRoute
      ? [
          "",
          `export default defineRoutePage<${JSON.stringify(routePattern)}${
            options.loader ? ", PageData" : ""
          }>(${JSON.stringify(routePattern)}, {`,
          ...(options.loader ? ["  load,"] : []),
          "  head,",
          `  default: ${componentName}`,
          "});",
        ]
      : []),
    ""
  ];
  await writeFileSafe(target, lines.join("\n"), options);
  console.log(`Generated page: ${target}`);
}

export async function generateNotFoundPage(
  options: GeneratorOptions = {}
): Promise<void> {
  const pagesDir = await pagesDirectory();
  await ensureDir(pagesDir);
  const target = path.join(pagesDir, "404.tsx");
  await writeFileSafe(target, [
    "export const head = <title>Page not found</title>;",
    "",
    "export default function NotFoundPage() {",
    "  return (",
    "    <main>",
    "      <h1>Page not found</h1>",
    "      <p>The requested page could not be found.</p>",
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n"), options);
  console.log(`Generated 404 page: ${target}`);
}

export async function generateErrorPage(
  options: GeneratorOptions = {}
): Promise<void> {
  const pagesDir = await pagesDirectory();
  await ensureDir(pagesDir);
  const target = path.join(pagesDir, "_error.tsx");
  await writeFileSafe(target, [
    "export const head = <title>Route error</title>;",
    "",
    "export default function ErrorPage() {",
    "  return (",
    "    <main>",
    "      <h1>Something went wrong</h1>",
    "      <p>The route could not be rendered.</p>",
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n"), options);
  console.log(`Generated error page: ${target}`);
}

export async function generateActionPage(
  name: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const pagesDir = await pagesDirectory();
  await ensureDir(pagesDir);
  const { target, componentName } = resolvePageTarget(pagesDir, name);
  const title = componentName.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  await writeFileSafe(target, [
    'import { defineAction } from "@tavojs/core/router";',
    "",
    "export const action = defineAction(async ({ request }) => {",
    "  const formData = await request.formData();",
    "  return { json: { ok: true, values: Object.fromEntries(formData) } };",
    "});",
    "",
    `export const head = <title>${title}</title>;`,
    "",
    `export default function ${componentName}() {`,
    "  return (",
    "    <main>",
    `      <h1>${title}</h1>`,
    '      <form method="post">',
    "        <label>",
    "          Name",
    '          <input name="name" required />',
    "        </label>",
    '        <button type="submit">Submit</button>',
    "      </form>",
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n"), options);
  console.log(`Generated action page: ${target}`);
}

export async function generateComponent(
  name: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const targetInfo = resolveNamedFolderTarget(
    path.resolve(process.cwd(), "src/components"),
    name,
    "index.tsx"
  );
  const exportName = toPascalCase(targetInfo.name);
  await writeFileSafe(targetInfo.target, [
    'import { createTavo } from "@tavojs/core";',
    "",
    ...(options.props ? [`type ${exportName}Props = {`, "  title: string;", "};", ""] : []),
    `export const ${exportName} = createTavo${
      options.props ? `<${exportName}Props, { count: number }>` : ""
    }({`,
    "  model: () => ({ count: 0 }),",
    options.props
      ? '  view: ({ props, state }) => <section><h2>{props.title}</h2>' +
        "<p>{state.count}</p></section>"
      : "  view: ({ state }) => <div>{state.count}</div>",
    "});",
    ""
  ].join("\n"), options);
  console.log(`Generated component: ${targetInfo.target}`);
}

export async function generateStore(
  name: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const storeDir = path.resolve(process.cwd(), "src/store");
  await ensureDir(storeDir);
  const normalized = normalizeGeneratorName(name);
  const target = path.join(storeDir, `${normalized}.ts`);
  const exportName = `${toCamelCase(normalized)}Store`;
  const shape = typeof options.shape === "string" && options.shape.length > 0
    ? options.shape
    : null;
  const shapeEntries = validateStoreShape(shape);
  await writeFileSafe(target, [
    'import { defineGlobalStore } from "@tavojs/core";',
    "",
    `export const ${exportName} = defineGlobalStore("${normalized}", () => ({`,
    ...(shapeEntries
      ? shapeEntries.map((entry) => `  ${entry}: null,`)
      : ["  ready: true"]),
    "}));",
    ""
  ].join("\n"), options);
  console.log(`Generated store: ${target}`);
}

export async function generateLayout(
  name: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const pagesDir = await pagesDirectory();
  const normalized = normalizeGeneratorName(name || "");
  const target = path.join(
    pagesDir,
    ...(normalized ? normalized.split("/") : []),
    "_layout.tsx"
  );
  await writeFileSafe(target, [
    'import type { PropsWithChildren } from "@tavojs/core";',
    "",
    "export default function Layout(props: PropsWithChildren) {",
    "  return <>{props.children}</>;",
    "}",
    ""
  ].join("\n"), options);
  console.log(`Generated layout: ${target}`);
}
