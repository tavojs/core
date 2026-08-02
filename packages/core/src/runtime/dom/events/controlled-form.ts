import { controlledFormState } from "./state.js";

export function restoreControlledFormTarget(target: EventTarget | null): void {
  const element =
    typeof Element !== "undefined" && target instanceof Element
      ? target
      : target && (target as Node).nodeType === 1
        ? (target as Element)
        : null;
  if (!element) {
    return;
  }

  const state = controlledFormState.get(element);
  if (!state) {
    return;
  }

  if (
    state.value !== undefined &&
    "value" in element &&
    (element as HTMLInputElement | HTMLTextAreaElement).value !== state.value
  ) {
    (element as HTMLInputElement | HTMLTextAreaElement).value = state.value;
  }
  if (
    state.checked !== undefined &&
    "checked" in element &&
    (element as HTMLInputElement).checked !== state.checked
  ) {
    (element as HTMLInputElement).checked = state.checked;
  }
}

export function setControlledFormValue(element: Element, key: "value" | "checked", value: string | boolean): void {
  const state = controlledFormState.get(element) ?? {};
  if (key === "value") {
    state.value = String(value);
  } else {
    state.checked = Boolean(value);
  }
  controlledFormState.set(element, state);
}

export function removeControlledFormValue(element: Element, key: "value" | "checked"): void {
  const state = controlledFormState.get(element);
  if (!state) {
    return;
  }
  delete state[key];
  if (state.value === undefined && state.checked === undefined) {
    controlledFormState.delete(element);
    return;
  }
  controlledFormState.set(element, state);
}
