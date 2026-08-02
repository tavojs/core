export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} kB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function parseByteSize(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  }
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib)?$/i);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier = unit === "kb" || unit === "kib"
    ? 1024
    : unit === "mb" || unit === "mib"
      ? 1024 * 1024
      : 1;
  return Math.floor(amount * multiplier);
}

export function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

export function toPascalCase(value: string): string {
  const identifier = value
    .split(/[\/_\-\s]+/)
    .filter(Boolean)
    .map((part: string) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^\d/.test(identifier) ? `_${identifier}` : identifier;
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal ? `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}` : "value";
}

export function cliExecHint(packageManager: string): string {
  if (packageManager === "pnpm") {
    return "pnpm exec";
  }
  if (packageManager === "yarn") {
    return "yarn";
  }
  if (packageManager === "bun") {
    return "bunx";
  }
  return "npx";
}
