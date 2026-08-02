const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function isVisible(element: HTMLElement): boolean {
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

/** Finds focusable descendants in DOM order. */
export function getFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(isVisible);
}

/** Focuses the first focusable descendant inside a root node. */
export function focusFirst(root: ParentNode, options?: FocusOptions): HTMLElement | null {
  const target = getFocusableElements(root)[0] ?? null;
  target?.focus(options);
  return target;
}

/** Focuses the first invalid form control inside a root node. */
export function focusFirstInvalid(root: ParentNode, options?: FocusOptions): HTMLElement | null {
  const target = root.querySelector<HTMLElement>(":invalid");
  target?.focus(options);
  return target;
}

/** Captures current focus and returns a function that restores it later. */
export function captureFocusRestore(documentRef: Document = document): () => void {
  const active = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
  return () => {
    active?.focus();
  };
}

/** Keeps Tab navigation inside a container until the returned cleanup runs. */
export function trapFocus(root: HTMLElement): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = getFocusableElements(root);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  root.addEventListener("keydown", onKeyDown);
  return () => root.removeEventListener("keydown", onKeyDown);
}
