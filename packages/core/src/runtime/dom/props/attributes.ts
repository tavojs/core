import {
  removeDelegatedListener,
  setDelegatedListener
} from "../events.js";
import { isSafeAttribute, isSafeAttributeName } from "../../../security.js";
import { normalizeClassName, type ClassName } from "../../../jsx.js";
import {
  isLiveFormProp,
  removeFormProp,
  setFormCheckedProp,
  setFormValueProp,
  shouldRefreshFormChangeListener
} from "./form.js";
import { applyStyle, toInlineStyle, toKebabCase } from "./style.js";

function isEventProp(key: string, value: unknown): value is EventListener {
  return key.startsWith("on") && typeof value === "function";
}

function isInternalProp(key: string): boolean {
  return key === "children" || key === "key" || key === "ref" || key === "use" || key === "transition";
}

function setProp(el: Element, key: string, value: unknown, previousValue: unknown): void {
  if (isInternalProp(key)) {
    return;
  }
  if (key.startsWith("on")) {
    if (isEventProp(key, value)) {
      setDelegatedListener(el, key, value);
      return;
    }
    removeDelegatedListener(el, key);
    return;
  }
  if (!isSafeAttribute(key, value)) {
    removeProp(el, key);
    return;
  }

  if (key === "className" || key === "class") {
    el.setAttribute("class", normalizeClassName(value as ClassName));
    return;
  }

  if (key === "style") {
    applyStyle(el as HTMLElement | SVGElement, previousValue, value);
    return;
  }

  if (key === "value" && setFormValueProp(el, value)) {
    return;
  }

  if (key === "checked" && setFormCheckedProp(el, value)) {
    return;
  }

  if (value === true) {
    el.setAttribute(key, "");
    return;
  }

  if (value === false || value === null || value === undefined) {
    el.removeAttribute(key);
    return;
  }

  el.setAttribute(key, String(value));
}

function setHydrationProp(el: Element, key: string, value: unknown): void {
  if (isInternalProp(key)) {
    return;
  }
  if (key.startsWith("on")) {
    if (isEventProp(key, value)) {
      setDelegatedListener(el, key, value);
      return;
    }
    removeDelegatedListener(el, key);
    return;
  }
  if (!isSafeAttribute(key, value)) {
    removeProp(el, key);
    return;
  }

  if (key === "className" || key === "class") {
    const nextClass = normalizeClassName(value as ClassName);
    if (el.getAttribute("class") !== nextClass) {
      el.setAttribute("class", nextClass);
    }
    return;
  }

  if (key === "style") {
    const styledEl = el as HTMLElement | SVGElement;
    if (typeof value === "string") {
      if (el.getAttribute("style") !== value) {
        el.setAttribute("style", value);
      }
      return;
    }
    const inlineStyle = toInlineStyle(value);
    if (inlineStyle === null) {
      if (el.hasAttribute("style")) {
        el.removeAttribute("style");
      }
      return;
    }

    if (el.getAttribute("style") === inlineStyle) {
      return;
    }

    const nextStyleRecord = value as Record<string, unknown>;
    const nextStyleNames = new Set<string>();
    for (const [styleKey, styleValue] of Object.entries(nextStyleRecord)) {
      const cssKey = toKebabCase(styleKey);
      nextStyleNames.add(cssKey);
      if (styleValue === null || styleValue === undefined || styleValue === false) {
        if (styledEl.style.getPropertyValue(cssKey) !== "") {
          styledEl.style.removeProperty(cssKey);
        }
        continue;
      }

      const nextStyleValue = String(styleValue);
      if (styledEl.style.getPropertyValue(cssKey) !== nextStyleValue) {
        styledEl.style.setProperty(cssKey, nextStyleValue);
      }
    }

    for (let index = styledEl.style.length - 1; index >= 0; index -= 1) {
      const cssKey = styledEl.style.item(index);
      if (!nextStyleNames.has(cssKey)) {
        styledEl.style.removeProperty(cssKey);
      }
    }
    return;
  }

  if (key === "value" && setFormValueProp(el, value)) {
    return;
  }

  if (key === "checked" && setFormCheckedProp(el, value)) {
    return;
  }

  if (value === true) {
    if (!el.hasAttribute(key)) {
      el.setAttribute(key, "");
    }
    return;
  }

  if (value === false || value === null || value === undefined) {
    if (el.hasAttribute(key)) {
      el.removeAttribute(key);
    }
    return;
  }

  const nextValue = String(value);
  if (el.getAttribute(key) !== nextValue) {
    el.setAttribute(key, nextValue);
  }
}

function removeProp(el: Element, key: string): void {
  if (isInternalProp(key)) {
    return;
  }
  if (!isSafeAttributeName(key)) {
    return;
  }
  if (key.startsWith("on")) {
    removeDelegatedListener(el, key);
    return;
  }
  if (key === "className" || key === "class") {
    el.removeAttribute("class");
    return;
  }
  if (key === "style") {
    el.removeAttribute("style");
    return;
  }
  if (removeFormProp(el, key)) {
    return;
  }
  el.removeAttribute(key);
}

export function patchProps(
  el: Element,
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): void {
  if (previous === next) {
    return;
  }

  for (const key of Object.keys(next)) {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (
      Object.is(previousValue, nextValue) &&
      !isLiveFormProp(el, key) &&
      !shouldRefreshFormChangeListener(el, key)
    ) {
      continue;
    }
    setProp(el, key, nextValue, previousValue);
  }

  for (const key of Object.keys(previous)) {
    if (key in next) {
      continue;
    }
    removeProp(el, key);
  }
}

export function hydrateProps(el: Element, next: Record<string, unknown>): void {
  for (const key of Object.keys(next)) {
    setHydrationProp(el, key, next[key]);
  }
}
