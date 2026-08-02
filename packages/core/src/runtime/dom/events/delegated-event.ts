function getEventPath(target: EventTarget | null): Element[] {
  const path: Element[] = [];
  let current =
    typeof Element !== "undefined" && target instanceof Element
      ? target
      : target && (target as Node).nodeType === 1
        ? (target as Element)
        : null;
  while (current) {
    path.push(current);
    current = current.parentElement;
  }
  return path;
}

function defineForwardedGetter<T extends object>(
  target: T,
  key: string,
  read: () => unknown
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: read
  });
}

export function createDelegatedEvent(event: Event, currentTarget: Element): Event {
  const delegated = {} as Event & { nativeEvent?: Event };
  defineForwardedGetter(delegated, "type", () => event.type);
  defineForwardedGetter(delegated, "target", () => event.target);
  defineForwardedGetter(delegated, "srcElement", () => (event as Event & { srcElement?: EventTarget | null }).srcElement ?? event.target);
  defineForwardedGetter(delegated, "currentTarget", () => currentTarget);
  defineForwardedGetter(delegated, "bubbles", () => event.bubbles);
  defineForwardedGetter(delegated, "cancelBubble", () => event.cancelBubble);
  defineForwardedGetter(delegated, "cancelable", () => event.cancelable);
  defineForwardedGetter(delegated, "composed", () => event.composed);
  defineForwardedGetter(delegated, "defaultPrevented", () => event.defaultPrevented);
  defineForwardedGetter(delegated, "eventPhase", () => event.eventPhase);
  defineForwardedGetter(delegated, "isTrusted", () => event.isTrusted);
  defineForwardedGetter(delegated, "returnValue", () => event.returnValue);
  defineForwardedGetter(delegated, "timeStamp", () => event.timeStamp);

  if (typeof MouseEvent !== "undefined" && event instanceof MouseEvent) {
    defineForwardedGetter(delegated, "button", () => event.button);
    defineForwardedGetter(delegated, "buttons", () => event.buttons);
    defineForwardedGetter(delegated, "clientX", () => event.clientX);
    defineForwardedGetter(delegated, "clientY", () => event.clientY);
    defineForwardedGetter(delegated, "ctrlKey", () => event.ctrlKey);
    defineForwardedGetter(delegated, "metaKey", () => event.metaKey);
    defineForwardedGetter(delegated, "shiftKey", () => event.shiftKey);
    defineForwardedGetter(delegated, "altKey", () => event.altKey);
    defineForwardedGetter(delegated, "detail", () => event.detail);
    defineForwardedGetter(delegated, "relatedTarget", () => event.relatedTarget);
  }

  if (typeof KeyboardEvent !== "undefined" && event instanceof KeyboardEvent) {
    defineForwardedGetter(delegated, "key", () => event.key);
    defineForwardedGetter(delegated, "code", () => event.code);
    defineForwardedGetter(delegated, "repeat", () => event.repeat);
    defineForwardedGetter(delegated, "ctrlKey", () => event.ctrlKey);
    defineForwardedGetter(delegated, "metaKey", () => event.metaKey);
    defineForwardedGetter(delegated, "shiftKey", () => event.shiftKey);
    defineForwardedGetter(delegated, "altKey", () => event.altKey);
  }

  Object.defineProperty(delegated, "nativeEvent", {
    configurable: true,
    enumerable: false,
    value: event
  });
  Object.defineProperty(delegated, "preventDefault", {
    configurable: true,
    enumerable: false,
    value: event.preventDefault.bind(event)
  });
  Object.defineProperty(delegated, "stopPropagation", {
    configurable: true,
    enumerable: false,
    value: event.stopPropagation.bind(event)
  });
  Object.defineProperty(delegated, "stopImmediatePropagation", {
    configurable: true,
    enumerable: false,
    value: event.stopImmediatePropagation.bind(event)
  });
  return delegated;
}

export function dispatchDelegatedEvent(
  eventName: string,
  event: Event,
  handlersByElement: WeakMap<Element, Map<string, EventListener>>
): void {
  const path = getEventPath(event.target);
  for (const node of path) {
    const handlers = handlersByElement.get(node);
    const handler = handlers?.get(eventName);
    if (!handler) {
      continue;
    }
    handler.call(node, createDelegatedEvent(event, node));
    if (event.cancelBubble) {
      return;
    }
  }
}
