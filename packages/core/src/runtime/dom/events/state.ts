export type HandlerMap = Map<string, EventListener>;

export type ControlledFormState = {
  value?: string;
  checked?: boolean;
};

export const elementHandlers = new WeakMap<Element, HandlerMap>();
export const elementPropEvents = new WeakMap<Element, Map<string, string>>();
export const registeredEvents = new WeakMap<Document, Set<string>>();
export const controlledFormState = new WeakMap<Element, ControlledFormState>();
