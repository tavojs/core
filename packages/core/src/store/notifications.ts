/** Deliver each snapshot before notifications from writes made by its listeners. */
export function createStoreNotifier<T>(deliver: (next: T, previous: T) => void) {
  const pending: Array<{ next: T; previous: T }> = [];
  let notifying = false;
  return (next: T, previous: T): void => {
    pending.push({ next, previous });
    if (notifying) return;
    notifying = true;
    try {
      for (let index = 0; index < pending.length; index += 1) {
        const snapshot = pending[index];
        deliver(snapshot.next, snapshot.previous);
      }
    } finally {
      pending.length = 0;
      notifying = false;
    }
  };
}
