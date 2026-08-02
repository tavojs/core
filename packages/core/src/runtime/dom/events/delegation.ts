import { restoreControlledFormTarget } from "./controlled-form.js";
import { dispatchDelegatedEvent } from "./delegated-event.js";
import { toEventName } from "./names.js";
import {
  elementHandlers,
  elementPropEvents,
  registeredEvents
} from "./state.js";

function ensureDocumentListener(eventName: string): void {
  if (typeof document === "undefined") {
    return;
  }

  let events = registeredEvents.get(document);
  if (!events) {
    events = new Set<string>();
    registeredEvents.set(document, events);
  }
  if (events.has(eventName)) {
    return;
  }
  events.add(eventName);

  document.addEventListener(eventName, (event) => {
    dispatchDelegatedEvent(eventName, event, elementHandlers);
    if (eventName === "input" || eventName === "change") {
      queueMicrotask(() => {
        restoreControlledFormTarget(event.target);
      });
    }
  });
}

export function setDelegatedListener(
  element: Element,
  propName: string,
  listener: EventListener
): void {
  const eventName = toEventName(element, propName);
  ensureDocumentListener(eventName);

  let handlers = elementHandlers.get(element);
  if (!handlers) {
    handlers = new Map<string, EventListener>();
    elementHandlers.set(element, handlers);
  }
  const propEvents = elementPropEvents.get(element) ?? new Map<string, string>();
  const previousEventName = propEvents.get(propName);
  if (previousEventName && previousEventName !== eventName) {
    handlers.delete(previousEventName);
  }
  propEvents.set(propName, eventName);
  elementPropEvents.set(element, propEvents);
  handlers.set(eventName, listener);
}

export function removeDelegatedListener(element: Element, propName: string): void {
  const handlers = elementHandlers.get(element);
  if (!handlers) {
    return;
  }
  const propEvents = elementPropEvents.get(element);
  const eventName = propEvents?.get(propName) ?? toEventName(element, propName);
  handlers.delete(eventName);
  propEvents?.delete(propName);
  if (propEvents?.size === 0) {
    elementPropEvents.delete(element);
  }
  if (handlers.size === 0) {
    elementHandlers.delete(element);
  }
}

export function ensureControlledFormListeners(): void {
  ensureDocumentListener("input");
  ensureDocumentListener("change");
}
