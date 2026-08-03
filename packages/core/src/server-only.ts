if (typeof (globalThis as { document?: unknown }).document !== "undefined") {
  throw new Error(
    "Tavo.js server-only module imported in the browser. Move this import behind a server-only action, loader, or middleware."
  );
}

export {};
