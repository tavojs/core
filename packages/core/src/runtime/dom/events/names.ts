function isTextChangeProp(element: Element, propName: string): boolean {
  if (propName !== "onChange") {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea") {
    return true;
  }
  if (tagName !== "input") {
    return false;
  }

  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
  ].includes(type);
}

export function toEventName(element: Element, propName: string): string {
  if (isTextChangeProp(element, propName)) {
    return "input";
  }
  return propName.slice(2).toLowerCase();
}
