const NOT_FOUND_SIGNAL = Symbol.for("@tavojs/core/not-found");

type NotFoundSignal = Error & {
  [NOT_FOUND_SIGNAL]: true;
};

/** Stops route resolution and renders the application's reserved 404 page. */
export function notFound(): never {
  const signal = new Error("Tavo route not found") as NotFoundSignal;
  signal.name = "NotFoundError";
  signal[NOT_FOUND_SIGNAL] = true;
  throw signal;
}

/** Returns true when a loader stopped resolution with `notFound()`. */
export function isNotFoundSignal(value: unknown): value is NotFoundSignal {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<NotFoundSignal>)[NOT_FOUND_SIGNAL] === true
  );
}
