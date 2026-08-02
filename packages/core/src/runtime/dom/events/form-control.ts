import {
  removeControlledFormValue as removeControlledFormValueState,
  setControlledFormValue as setControlledFormValueState
} from "./controlled-form.js";
import { ensureControlledFormListeners } from "./delegation.js";

export function setControlledFormValue(element: Element, key: "value" | "checked", value: string | boolean): void {
  setControlledFormValueState(element, key, value);
  ensureControlledFormListeners();
}

export function removeControlledFormValue(element: Element, key: "value" | "checked"): void {
  removeControlledFormValueState(element, key);
}
