/** Detects a hydratable server-rendered document from Tavo's serialized state. */
export function isSsrDocument(root?: Element | null): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const appRoot = root ?? document.querySelector("#app");
  if (appRoot?.getAttribute("data-tavo-render-mode") === "csr") {
    return false;
  }
  return document.getElementById("__TAVO_STATE__") !== null;
}
