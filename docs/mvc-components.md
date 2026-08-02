# MVC Components

> Online guide: [tavojs.dev/docs/core/mvc](https://tavojs.dev/docs/core/mvc)

This guide explains the main Tavo programming model: `createTavo(...)`.

## Core Idea

Tavo components are built from three parts:

- `model`: local reactive state
- `controller`: business logic and orchestration
- `view`: TSX rendering

This keeps UI logic explicit and makes state changes easy to trace.
There are no public component hooks in Tavo; component behavior belongs in controllers, stores, refs, directives, and explicit lifecycle methods.

## Basic Example

```tsx
import { createTavo, TavoController } from "@tavojs/core";

class CounterController extends TavoController {
  increment() {
    this.model.patch((state) => ({
      count: state.count + 1,
    }));
  }
}

export const Counter = createTavo({
  model: () => ({
    count: 0,
  }),
  controller: CounterController,
  view: ({ state, controller }) => (
    <button type="button" onClick={() => controller?.increment()}>
      Count: {state.count}
    </button>
  ),
});
```

## `createTavo(...)`

The main API shape is:

```ts
createTavo({
  model,
  controller,
  createController,
  view,
})
```

Notes:

- `model` is optional
- `controller` is optional
- `createController` creates a controller from a factory function
- `view` is required

## Optional Model And Controller

Components can be render-only, stateful, controller-backed, or any combination.

Simple render-only component:

```tsx
const Card = createTavo({
  view: ({ props }) => <section>{props.children}</section>,
});
```

Model-only component:

```tsx
const Counter = createTavo({
  model: () => ({ count: 0 }),
  view: ({ state, model }) => (
    <button onClick={() => model.patch({ count: state.count + 1 })}>
      {state.count}
    </button>
  ),
});
```

## Controller Injection

Controllers automatically receive:

- `this.model`
- `this.props`
- `this.page`
- `this.router`
- `this.stores`
- `this.services`

That means you do not need to manually wire a constructor just to receive model or framework services.

Example:

```ts
class NavController extends TavoController {
  onInit() {
    this.model.patch({
      pathname: this.page.pathname,
      routes: this.router.routes,
    });
  }

  open(pathname: string) {
    this.router.navigate(pathname);
  }
}
```

## Controller Lifecycle

Supported controller lifecycle methods:

- `onInit()`
- `onMount()`
- `onLayout()`
- `afterRender()`
- `onDestroy()`
- `onPropsChange(nextProps)`

Use them for:

- startup subscriptions
- DOM work after mount or layout
- interval setup
- reacting to prop changes
- cleanup registration

`onMount()` and `onLayout()` may return a cleanup function. You can also call `this.cleanup(fn)` from any controller method once the component has initialized.

## DOM Refs

Use `createRef()` when a controller needs direct access to a DOM element. Refs are assigned on mount/hydration, updated when a `ref` prop changes, and cleared automatically on unmount.

```tsx
import { createRef, createTavo, TavoController } from "@tavojs/core";

class SearchController extends TavoController {
  input = createRef<HTMLInputElement>();

  focusInput() {
    this.input.current?.focus();
  }
}

export const SearchBox = createTavo({
  controller: SearchController,
  view: ({ controller }) => {
    if (!controller) return null;
    return (
      <form>
        <input ref={controller.input} placeholder="Search docs" />
        <button type="button" onClick={() => controller.focusInput()}>
          Focus
        </button>
      </form>
    );
  },
});
```

Callback refs are also supported for one-off element access:

```tsx
<section ref={(node) => console.log(node)} />
```

Refs can be forwarded through your own components by accepting the `ref` prop and attaching it to a DOM element:

```tsx
const Field = createTavo({
  view: ({ props }) => (
    <input ref={props.ref} placeholder={props.placeholder as string} />
  ),
});

const input = createRef<HTMLInputElement>();

<Field ref={input} placeholder="Email" />
```

Useful ref helpers:

- `setRef(ref, node)` assigns or clears any ref shape
- `mergeRefs(...refs)` combines multiple refs
- `createListRefs()` manages refs for keyed lists

## DOM Directives And Transitions

Use the `use` prop for reusable DOM behavior. Directives run when an element mounts or hydrates, rerun when the directive changes, and clean up automatically.

```tsx
import { autoFocus, createDirective } from "@tavojs/core";

const selectText = createDirective<HTMLInputElement>((node) => {
  node.select();
});

<input use={[autoFocus(), selectText]} />
```

For lightweight enter/leave behavior, use `transition`:

```tsx
<section
  transition={{
    classes: {
      enter: "fade-enter",
      enterActive: "fade-enter-active",
      leave: "fade-leave",
    },
    onEnter: (node) => console.log("entered", node),
    onLeave: (node) => console.log("leaving", node),
  }}
/>
```

## Focus And Observers

Controllers can define lifecycle methods directly. Tavo calls them automatically and cleans up returned functions on unmount:

```tsx
import { createRef, createTavo, focusFirst, TavoController } from "@tavojs/core";

class DialogController extends TavoController {
  dialog = createRef<HTMLDivElement>();

  onMount() {
    if (this.dialog.current) {
      focusFirst(this.dialog.current);
    }

    this.observeResize(this.dialog, () => {
      console.log("dialog resized");
    });
  }

  afterRender() {
    console.log("dialog rendered");
  }
}

export const Dialog = createTavo({
  controller: DialogController,
  view: ({ controller }) => {
    if (!controller) return null;
    return (
      <div ref={controller.dialog}>
        <button>First focus target</button>
      </div>
    );
  },
});
```

Available helpers:

- `onLayout()` runs during the layout phase and can return cleanup
- `onMount()` runs after mount and can return cleanup
- `afterRender()` runs after each committed render
- `this.createId(prefix?)` creates deterministic SSR/hydration-safe IDs
- `this.action(fn)` creates controller-local async actions with reactive state
- `this.scheduleLayoutEffect(fn)` dynamically registers a layout callback
- `this.scheduleOnMount(fn)` dynamically registers a mount callback
- `this.scheduleAfterRender(fn)` dynamically registers a post-render callback
- `this.observeResize(refOrElement, listener)`
- `this.observeIntersection(refOrElement, listener)`
- `this.observeMutation(refOrNode, listener)`
- `focusFirst(root)`, `focusFirstInvalid(root)`, `trapFocus(root)`, `captureFocusRestore()`

## Managed Cleanup

Controllers should not manually track arrays of unsubscribers.

Use the built-in managed helpers:

- `this.cleanup(fn)`
- `this.listen(store, listener, options?)`
- `this.select(store, selector, listener, options?)`
- `this.watch(store, target, listener, options?)`
- `this.listenExternal(store, listener, options?)`

Everything registered through those helpers is disposed automatically on unmount.

## `this.page`

`this.page` groups route-local data:

- `pathname`
- `route`
- `status`
- `data`
- `params`
- `error`
- `layers`
- `layerData`

Use it when controller behavior depends on the current page.

## `this.router`

`this.router` groups navigation and route catalog access:

- `navigate(...)`
- `pushUrl(...)`
- `replaceUrl(...)`
- `prefetch(...)`
- `routes`

Use `navigate(...)` when the app should resolve and render another route. Use
`pushUrl(...)` or `replaceUrl(...)` when the browser URL should change without
remounting the current page or losing component state.

## `this.stores` And `this.services`

Controllers can resolve shared app dependencies without direct imports:

- `this.stores.get(name)`
- `this.services.get(name)`
- `this.services.tryGet(name)`

This is especially useful for:

- analytics
- app controllers
- shared global stores
- integration services

## Derived Render State

Keep expensive calculations out of `view` when the result affects rendering. Compute the derived value in a controller when its inputs change, store the result in the model, and let the view render the cached field.

```tsx
import { TavoController, createStore, createTavo, shallowEqual } from "@tavojs/core";

const sourceStore = createStore({
  items: [
    { id: "a", price: 20, quantity: 2 },
    { id: "b", price: 15, quantity: 1 },
  ],
});

function summarizeItems(items: Array<{ price: number; quantity: number }>) {
  return {
    count: items.length,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
}

class DashboardController extends TavoController {
  onInit() {
    this.select(
      sourceStore,
      (state) => state.items,
      (items) => {
        this.model.patch({ summary: summarizeItems(items) });
      },
      { immediate: true, isEqual: shallowEqual },
    );
  }
}

const Dashboard = createTavo({
  model: () => ({
    summary: { count: 0, total: 0 },
  }),
  controller: DashboardController,
  view: ({ state }) => (
    <section>
      <strong>{state.summary.count} items</strong>
      <span>Total: {state.summary.total}</span>
    </section>
  ),
});
```

For values derived from the component's own model, expose a controller method and call it from the same mutations that change the source data:

```ts
class CartController extends TavoController {
  refreshSummary() {
    const { items } = this.model.getState();
    this.model.patch({ summary: summarizeItems(items) });
  }

  addItem(item) {
    this.model.patch((state) => ({ items: [...state.items, item] }));
    this.refreshSummary();
  }
}
```

Use `computedStore(...)` instead when a derived value is shared by several components.

## Best Practices

- keep controllers focused on behavior, not markup
- keep views declarative and thin
- compute expensive render state in controllers or computed stores instead of recalculating it inside `view`
- use small connected components rather than one large component with many unrelated updates
- move shared state to stores when multiple components need it
- use refs and directives for DOM access instead of view-local state machinery
- use `shallowEqual` for selector results that return small objects

## Next Reading

- [Stores](./stores.md)
- [Routing And Pages](./routing-and-pages.md)
