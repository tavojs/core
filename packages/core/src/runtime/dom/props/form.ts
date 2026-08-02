import {
  removeControlledFormValue,
  setControlledFormValue
} from "../events.js";

export function canUseValueProperty(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const tagName = el.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") {
    return true;
  }
  return tagName === "input" && (el.getAttribute("type") ?? "text").toLowerCase() !== "file";
}

export function canUseCheckedProperty(el: Element): el is HTMLInputElement {
  return el.tagName.toLowerCase() === "input";
}

export function setFormValueProp(el: Element, value: unknown): boolean {
  if (!canUseValueProperty(el)) {
    return false;
  }

  if (value === false || value === null || value === undefined) {
    el.removeAttribute("value");
    el.value = "";
    removeControlledFormValue(el, "value");
    return true;
  }

  const nextValue = String(value);
  el.setAttribute("value", nextValue);
  if (el.value !== nextValue) {
    el.value = nextValue;
  }
  setControlledFormValue(el, "value", nextValue);
  return true;
}

export function setFormCheckedProp(el: Element, value: unknown): boolean {
  if (!canUseCheckedProperty(el)) {
    return false;
  }

  const nextChecked = Boolean(value);
  if (nextChecked) {
    el.setAttribute("checked", "");
  } else {
    el.removeAttribute("checked");
  }
  if (el.checked !== nextChecked) {
    el.checked = nextChecked;
  }

  if (value === null || value === undefined) {
    removeControlledFormValue(el, "checked");
  } else {
    setControlledFormValue(el, "checked", nextChecked);
  }
  return true;
}

export function isLiveFormProp(el: Element, key: string): boolean {
  return (key === "value" && canUseValueProperty(el)) || (key === "checked" && canUseCheckedProperty(el));
}

export function shouldRefreshFormChangeListener(el: Element, key: string): boolean {
  const tagName = el.tagName.toLowerCase();
  return key === "onChange" && (tagName === "input" || tagName === "textarea");
}

export function removeFormProp(el: Element, key: string): boolean {
  if (key === "value" && canUseValueProperty(el)) {
    el.removeAttribute("value");
    el.value = "";
    removeControlledFormValue(el, "value");
    return true;
  }
  if (key === "checked" && canUseCheckedProperty(el)) {
    el.removeAttribute("checked");
    el.checked = false;
    removeControlledFormValue(el, "checked");
    return true;
  }
  return false;
}
