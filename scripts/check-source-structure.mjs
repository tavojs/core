import fs from "node:fs";
import path from "node:path";

const reportAll = process.argv.includes("--all");
const SOURCE_ROOTS = [path.resolve("packages/core/src"), path.resolve("packages/cli/src")];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const MAX_FILE_LINES = 400;
const MAX_LINE_LENGTH = 140;
const baseline = JSON.parse(
  fs.readFileSync(new URL("./source-structure-baseline.json", import.meta.url), "utf8")
);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [target] : [];
  });
}

const violations = [];
for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
  const relative = path.relative(process.cwd(), file).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const allowance = baseline[relative] ?? {};
  const fileLimit = reportAll ? MAX_FILE_LINES : allowance.maxLines ?? MAX_FILE_LINES;
  if (lines.length > fileLimit) {
    violations.push(
      `${relative}: ${lines.length} lines exceeds the ${fileLimit}-line module budget`
    );
  }
  const longLines = lines
    .map((line, index) => ({ index, length: line.length }))
    .filter((line) => line.length > MAX_LINE_LENGTH);
  const allowedLongLines = reportAll ? 0 : allowance.maxLongLines ?? 0;
  const allowedLongLength = reportAll
    ? MAX_LINE_LENGTH
    : allowance.maxLongLineLength ?? MAX_LINE_LENGTH;
  if (longLines.length > allowedLongLines) {
    violations.push(
      `${relative}: ${longLines.length} long lines exceeds the ${allowedLongLines}-line baseline`
    );
  }
  const longest = longLines.reduce((maximum, line) => Math.max(maximum, line.length), 0);
  if (longest > allowedLongLength) {
    const offender = longLines.find((line) => line.length === longest);
    violations.push(
      `${relative}:${offender.index + 1}: ${longest} characters exceeds the ` +
      `${allowedLongLength}-character baseline`
    );
  }
}

if (violations.length > 0) {
  const output = reportAll ? console.log : console.error;
  output(`${reportAll ? "Framework source audit" : "Source structure ratchet failed"}:\n`);
  output(violations.map((violation) => `- ${violation}`).join("\n"));
  output(
    "\nSplit modules by responsibility or wrap the expression instead of raising the budget."
  );
  if (!reportAll) process.exitCode = 1;
} else {
  console.log(
    "Source structure ratchet passed for core and CLI."
  );
}
