export type ElementCleanup = () => void;
export type ElementDirective<T extends HTMLElement = HTMLElement> = (
  element: T
) => void | ElementCleanup;
export type ElementDirectiveInput<T extends HTMLElement = HTMLElement> =
  | ElementDirective<T>
  | Array<ElementDirective<T> | null | undefined | false>
  | null
  | undefined
  | false;

export type TransitionClassNames = {
  enter?: string;
  enterActive?: string;
  leave?: string;
  leaveActive?: string;
};

export type TransitionOptions<T extends HTMLElement = HTMLElement> = {
  classes?: TransitionClassNames;
  onEnter?: (element: T) => void;
  onLeave?: (element: T) => void;
};

function normalizeDirectives<T extends HTMLElement>(
  value: ElementDirectiveInput<T>
): Array<ElementDirective<T>> {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is ElementDirective<T> => typeof item === "function");
  }
  return typeof value === "function" ? [value] : [];
}

/** Runs element directives and returns a cleanup function. */
export function applyElementDirectives<T extends HTMLElement>(
  element: T,
  value: ElementDirectiveInput<T>
): ElementCleanup | null {
  const directives = normalizeDirectives(value);
  if (directives.length === 0) {
    return null;
  }

  const cleanups: ElementCleanup[] = [];
  for (const directive of directives) {
    const cleanup = directive(element);
    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  }

  if (cleanups.length === 0) {
    return null;
  }

  return () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      cleanups[index]();
    }
  };
}

/** Creates a reusable element directive from a function. */
export function createDirective<T extends HTMLElement = HTMLElement>(
  directive: ElementDirective<T>
): ElementDirective<T> {
  return directive;
}

/** Creates a directive that focuses the element after it is mounted. */
export function autoFocus<T extends HTMLElement = HTMLElement>(
  options?: FocusOptions
): ElementDirective<T> {
  return (element) => {
    queueMicrotask(() => element.focus(options));
  };
}

/** Creates a small class/callback transition directive for mounted elements. */
export function transition<T extends HTMLElement = HTMLElement>(
  options: TransitionOptions<T> = {}
): ElementDirective<T> {
  return (element) => {
    const classes = options.classes ?? {};
    if (classes.enter) {
      element.classList.add(classes.enter);
    }
    options.onEnter?.(element);
    queueMicrotask(() => {
      if (classes.enterActive) {
        element.classList.add(classes.enterActive);
      }
      if (classes.enter) {
        element.classList.remove(classes.enter);
      }
    });

    return () => {
      if (classes.leave) {
        element.classList.add(classes.leave);
      }
      if (classes.leaveActive) {
        element.classList.add(classes.leaveActive);
      }
      options.onLeave?.(element);
    };
  };
}
