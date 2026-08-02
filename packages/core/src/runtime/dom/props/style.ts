export function toKebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export function toInlineStyle(style: unknown): string | null {
  if (typeof style === "string") {
    return style;
  }
  if (typeof style !== "object" || style === null) {
    return null;
  }

  const parts: string[] = [];
  for (const [key, raw] of Object.entries(style)) {
    if (raw === null || raw === undefined || raw === false) {
      continue;
    }
    parts.push(`${toKebabCase(key)}:${String(raw)}`);
  }
  return parts.length > 0 ? parts.join(";") : null;
}

export function applyStyle(el: HTMLElement | SVGElement, previousValue: unknown, nextValue: unknown): void {
  if (previousValue === nextValue) {
    return;
  }
  if (typeof nextValue === "string") {
    el.setAttribute("style", nextValue);
    return;
  }

  if (typeof nextValue !== "object" || nextValue === null) {
    el.removeAttribute("style");
    return;
  }

  if (typeof previousValue === "object" && previousValue !== null) {
    for (const key of Object.keys(previousValue as Record<string, unknown>)) {
      if (!(key in (nextValue as Record<string, unknown>))) {
        el.style.removeProperty(toKebabCase(key));
      }
    }
  }

  const styleRecord = nextValue as Record<string, unknown>;
  for (const key of Object.keys(styleRecord)) {
    const styleValue = styleRecord[key];
    if (
      typeof previousValue === "object" &&
      previousValue !== null &&
      Object.is((previousValue as Record<string, unknown>)[key], styleValue)
    ) {
      continue;
    }
    if (styleValue === null || styleValue === undefined || styleValue === false) {
      el.style.removeProperty(toKebabCase(key));
      continue;
    }
    el.style.setProperty(toKebabCase(key), String(styleValue));
  }
}
