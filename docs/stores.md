# Stores

> Online guide: [tavojs.dev/docs/core/stores](https://tavojs.dev/docs/core/stores)

This guide covers Tavo’s reactive store model.

## `createStore(...)`

The core primitive is:

```ts
import { createStore } from "@tavojs/core";

const counterStore = createStore({
  count: 0,
});
```

Stores can also define action methods in the initializer. The initializer receives a partial `set(...)` helper and a `get()` helper:

```ts
const appStore = createStore((set, get) => ({
  theme: "sunset",
  authenticated: false,
  setTheme(value: string) {
    set({ theme: value });
  },
  toggleAuth() {
    set({ authenticated: !get().authenticated });
  },
}));
```

The initializer `set(...)` helper is intentionally a partial state merge helper. It is best for action methods that update one or more top-level fields.

Stores expose:

- `getState()`
- `setState(next)`
- `set(target, valueOrUpdater)`
- `patch(partial)`
- `subscribe(listener)`
- `subscribeSelector(selector, listener, options?)`
- `watch(target, listener, options?)`

## `getState()`

Read the current state synchronously:

```ts
const snapshot = counterStore.getState();
```

Use this for:

- controller sync steps
- one-off reads
- derived mutations

## `setState(...)`

Replace the whole store value:

```ts
counterStore.setState({
  count: 10,
});
```

Or use an updater:

```ts
counterStore.setState((previous) => ({
  ...previous,
  count: previous.count + 1,
}));
```

When your store keeps action methods inside state, prefer initializer `set(...)`, `patch(...)`, or runtime `set(...)` for normal mutations. `setState(...)` replaces the whole object, so a full replacement must include any action methods you still need.

## `set(...)`

After the store is created, `store.set(...)` sets one top-level key or nested path while keeping the rest of the state intact:

```ts
counterStore.set("count", 2);
counterStore.set("profile.name", "Ada");
```

The second argument can also be an updater that receives the previous selected value and the full state:

```ts
counterStore.set("count", (count) => count + 1);
counterStore.set("profile.name", (name, state) =>
  state.theme === "mint" ? "Grace" : name,
);
```

Runtime `store.set(...)` writes immutably, so selector subscriptions and `watch(...)` listeners still receive precise updates.

## `patch(...)`

Patch top-level fields:

```ts
counterStore.patch({
  count: 2,
});
```

Or:

```ts
counterStore.patch((previous) => ({
  count: previous.count + 1,
}));
```

For stores without action methods, this is a common update style in Tavo app code. For action-oriented stores, prefer putting mutations in initializer methods that call the initializer `set(...)` helper.

## `subscribe(...)`

Subscribe to any change:

```ts
const stop = counterStore.subscribe((next, previous) => {
  console.log(previous.count, next.count);
});
```

Use this when any change matters.

## `subscribeSelector(...)`

Subscribe only to a derived slice:

```ts
const stop = counterStore.subscribeSelector(
  (state) => state.count,
  (nextCount, previousCount) => {
    console.log(previousCount, nextCount);
  },
);
```

This is the main building block for granular updates.

## `watch(...)`

Watch a selector, top-level key, or nested path:

```ts
store.watch("theme", (next, previous) => {
  console.log(previous, next);
});

store.watch("profile.name", (next, previous) => {
  console.log(previous, next);
});
```

This is useful for controller-oriented business logic.

## Equality Control

Selectors can use custom equality:

```ts
import { shallowEqual } from "@tavojs/core";

store.subscribeSelector(
  (state: { profile: { name: string; role: string } }) => ({
    name: state.profile.name,
    role: state.profile.role,
  }),
  (next: { name: string; role: string }) => {
    console.log(next);
  },
  { isEqual: shallowEqual },
);
```

Use this when selectors return small object snapshots.

## Global Stores

Use framework-level registration for app-wide stores:

```ts
import { defineGlobalStore } from "@tavojs/core";

export const appStore = defineGlobalStore("app", (set) => ({
  theme: "sunset",
  authenticated: false,
  setTheme(value: string) {
    set({ theme: value });
  },
}));
```

Plain object initial state and no-argument initializer functions are still supported, but action initializers are the recommended pattern for app-level stores that own their mutations.

Then controllers can access it through:

```ts
this.stores.get("app")
```

## Store Use In MVC Components

Inside a controller:

```ts
class ProfileController extends TavoController {
  onInit() {
    const appStore = this.stores.get("app");
    this.select(
      appStore,
      (state) => state.user,
      (user) => {
        this.model.patch({ user });
      },
    );
  }
}
```

This keeps the view local while the source data stays global.

## Derived Values For Views

For expensive calculations that feed rendering, prefer controller-managed model fields over recomputing locals in `view`. The controller can subscribe to the precise input, run the calculation only when that input changes, and patch the model with the cached result.

```ts
function summarizeOrders(orders) {
  return {
    count: orders.length,
    revenue: orders.reduce((sum, order) => sum + order.total, 0),
  };
}

class OrdersController extends TavoController {
  onInit() {
    const ordersStore = this.stores.get("orders");
    this.select(
      ordersStore,
      (state) => state.orders,
      (orders) => {
        this.model.patch({ summary: summarizeOrders(orders) });
      },
      { immediate: true },
    );
  }
}
```

Then the view reads the derived model field:

```tsx
view: ({ state }) => <OrdersSummary summary={state.summary} />
```

For component-local data, run the same recompute method from controller mutations that change the source field. For derived values shared across components, create a `computedStore(...)` instead.

## Extras

`@tavojs/core` also exports:

- `computedStore(...)`
- `persistStore(...)`

### `computedStore(...)`

Create a derived store from another store:

```ts
const summaryStore = computedStore(appStore, (state) => ({
  total: state.items.length,
}));
```

Use a computed store when the derived value is shared by more than one component or should be subscribed to directly. Use a controller-owned model field when the value is only needed by one `createTavo` view.

### `persistStore(...)`

Persist a store to browser storage:

```ts
persistStore(appStore, {
  key: "tavo-app",
});
```

Use this for small UI state, not large data caches.

## Best Practices

- keep state normalized enough that selectors stay cheap
- subscribe as close as possible to the component that needs the data
- compute heavy render inputs in controllers or `computedStore(...)`, not as uncached locals inside `view`
- use `shallowEqual` for small structured selector outputs
- avoid one giant page component reading everything from one store

## Next Reading

- [MVC Components](./mvc-components.md)
- [Data Loading And Middleware](./data-loading-and-middleware.md)
