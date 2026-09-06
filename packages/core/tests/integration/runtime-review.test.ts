import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot, createTavo, h, TavoController } from "../../src/index.tsx";
import { createControllerTools } from "../../src/framework/mvc/tools.ts";
import {
  cleanupComponentRuntime,
  createComponentRuntimeState,
  withActiveComponent
} from "../../src/runtime/dom/component-runtime.ts";
import { patchProps } from "../../src/runtime/dom/props/attributes.ts";
import {
  cancelScheduledComponent,
  flushSync,
  getScheduledUpdateCount,
  runWithUpdatePriority,
  scheduleComponent
} from "../../src/runtime/dom/scheduler.ts";
import type { MountedComponent } from "../../src/runtime/dom/types.ts";
import { computedStore, createStore, persistStore } from "../../src/store/index.ts";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='app'></div></body></html>");
  const keys = ["window", "document", "Node", "Element", "HTMLElement", "Text"] as const;
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  return {
    dom,
    app: dom.window.document.getElementById("app")!,
    cleanup() {
      dom.window.close();
      keys.forEach((key, index) => {
        if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  };
}

test("omitting an event prop removes its delegated handler", () => {
  const { dom, app, cleanup } = setupDom();
  try {
    const button = dom.window.document.createElement("button");
    app.append(button);
    let calls = 0;
    const props = { onClick: () => { calls += 1; } };
    patchProps(button, {}, props);
    button.click();
    patchProps(button, props, {});
    button.click();
    assert.equal(calls, 1);
    assert.equal(button.hasAttribute("onclick"), false);
  } finally {
    cleanup();
  }
});

test("delegated focus and blur reach their target and ancestors once", () => {
  const { dom, app, cleanup } = setupDom();
  try {
    const input = dom.window.document.createElement("input");
    const nextInput = dom.window.document.createElement("input");
    app.append(input, nextInput);
    const calls: string[] = [];
    patchProps(app, {}, { onFocus: () => calls.push("parent-focus"), onBlur: () => calls.push("parent-blur") });
    patchProps(input, {}, {
      onFocus: (event: Event) => {
        assert.equal(event.target, input);
        assert.equal(event.currentTarget, input);
        assert.equal(event.type, "focus");
        calls.push("input-focus");
      },
      onBlur: (event: FocusEvent) => {
        assert.equal(event.relatedTarget, nextInput);
        calls.push("input-blur");
      }
    });
    input.focus();
    nextInput.focus();
    assert.deepEqual(calls, ["input-focus", "parent-focus", "input-blur", "parent-blur", "parent-focus"]);
  } finally {
    cleanup();
  }
});

for (const [propName, eventName] of [["onLoad", "load"], ["onScroll", "scroll"], ["onMouseEnter", "mouseenter"]]) {
  test(`${propName} targets its element without bubbling and is removed on update and unmount`, () => {
    const { dom, app, cleanup } = setupDom();
    const root = createRoot(app);
    const calls: string[] = [];
    const childProps = {
      [propName]: (event: Event) => {
        assert.equal(event.currentTarget, child);
        assert.equal(event.target, child);
        calls.push("child");
      }
    };
    const parentProps = { [propName]: () => calls.push("parent") };
    let child: Element;
    try {
      root.render(h("div", parentProps, h("div", childProps)));
      const parent = app.firstElementChild!;
      child = parent.firstElementChild!;
      child.dispatchEvent(new dom.window.Event(eventName));
      assert.deepEqual(calls, ["child"]);
      parent.dispatchEvent(new dom.window.Event(eventName));
      assert.deepEqual(calls, ["child", "parent"]);
      root.render(h("div", parentProps, h("div", {})));
      child.dispatchEvent(new dom.window.Event(eventName));
      assert.deepEqual(calls, ["child", "parent"]);
      root.render(h("div", parentProps, h("div", childProps)));
      root.unmount();
      app.append(parent);
      child.dispatchEvent(new dom.window.Event(eventName));
      parent.dispatchEvent(new dom.window.Event(eventName));
      assert.deepEqual(calls, ["child", "parent"]);
    } finally {
      root.unmount();
      cleanup();
    }
  });
}

test("a throwing controller destroy hook still releases all managed resources", async () => {
  const { app, cleanup } = setupDom();
  const source = createStore({ count: 0 });
  const calls: string[] = [];
  class Controller extends TavoController {
    onMount() {
      this.cleanup(() => { calls.push("first"); throw new Error("cleanup failed"); });
      this.listen(source, () => calls.push("listener"));
      this.setTimeout(() => calls.push("timeout"), 10);
      this.cleanup(() => { calls.push("last"); });
    }
    onDestroy() {
      calls.push("destroy");
      throw new Error("destroy failed");
    }
  }
  const Component = createTavo({ controller: Controller, view: () => h("p", null, "ready") });
  const root = createRoot(app);
  try {
    root.render(h(Component, {}));
    await Promise.resolve();
    root.unmount();
    source.set("count", 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, ["destroy", "first", "last"]);
    root.unmount();
    assert.deepEqual(calls, ["destroy", "first", "last"]);
  } finally {
    root.unmount();
    cleanup();
  }
});

test("unmounted inputs release controlled form restoration", async () => {
  const { dom, app, cleanup } = setupDom();
  const root = createRoot(app);
  try {
    root.render(h("input", { value: "controlled" }));
    const input = app.firstElementChild as HTMLInputElement;
    root.unmount();
    app.append(input);
    input.value = "native";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await Promise.resolve();
    assert.equal(input.value, "native");
  } finally {
    root.unmount();
    cleanup();
  }
});

test("managed cleanup failures do not skip later cleanups", () => {
  const tools = createControllerTools("test", () => {});
  const calls: number[] = [];
  tools.cleanup(() => { calls.push(1); throw new Error("failed"); });
  tools.cleanup(() => { calls.push(2); });
  assert.doesNotThrow(() => tools.flushCleanups());
  tools.flushCleanups();
  assert.deepEqual(calls, [1, 2]);
});

test("controller teardown preserves the original destroy error and runs once", () => {
  const error = new Error("original destroy error");
  const calls: string[] = [];
  const component = {
    runtime: createComponentRuntimeState(),
    rerender() {}
  } as unknown as MountedComponent;
  const Component = createTavo({
    createController(context) {
      context.cleanup(() => { calls.push("cleanup"); throw new Error("cleanup error"); });
      return { onDestroy() { calls.push("destroy"); throw error; } };
    },
    view: () => null
  });
  try {
    withActiveComponent(component, () => Component({}));
    const teardown = Array.from(component.runtime.cleanups).at(-1)!;
    assert.throws(teardown, (caught) => caught === error);
    assert.doesNotThrow(teardown);
    assert.deepEqual(calls, ["destroy", "cleanup"]);
  } finally {
    cleanupComponentRuntime(component);
  }
});

test("scheduler upgrades, deduplicates and cancels queued priorities", async () => {
  const calls: string[] = [];
  const component = (name: string) => ({
    unmounted: false,
    performRender: () => calls.push(name)
  } as unknown as MountedComponent);
  const normal = component("normal");
  const background = component("background");
  const cancelled = component("cancelled");
  const idle = component("idle");
  runWithUpdatePriority("idle", () => scheduleComponent(idle));
  runWithUpdatePriority("background", () => {
    scheduleComponent(background);
    scheduleComponent(cancelled);
  });
  scheduleComponent(normal);
  scheduleComponent(normal);
  cancelScheduledComponent(cancelled);
  cancelScheduledComponent(cancelled);
  flushSync(() => scheduleComponent(background));
  assert.deepEqual(calls, ["background"]);
  assert.equal(getScheduledUpdateCount(), 2);
  await Promise.resolve();
  assert.deepEqual(calls, ["background", "normal"]);
  runWithUpdatePriority("normal", () => scheduleComponent(idle));
  await Promise.resolve();
  assert.deepEqual(calls, ["background", "normal", "idle"]);
  assert.equal(getScheduledUpdateCount(), 0);
});

test("scheduler retains updates queued while a component renders", async () => {
  let renders = 0;
  const component = {
    unmounted: false,
    performRender() {
      renders += 1;
      if (renders === 1) scheduleComponent(component);
    }
  } as unknown as MountedComponent;
  scheduleComponent(component);
  await Promise.resolve();
  assert.equal(renders, 2);
  assert.equal(getScheduledUpdateCount(), 0);
  scheduleComponent(component);
  await Promise.resolve();
  assert.equal(renders, 3);
  assert.equal(getScheduledUpdateCount(), 0);
});

test("reentrant store writes notify in order and keep computed stores current", () => {
  const source = createStore({ count: 0 });
  source.watch("count", (count) => {
    if (count === 1) source.set("count", 2);
  });
  const derived = computedStore(source, ({ count }) => ({ doubled: count * 2 }));
  const calls: number[] = [];
  source.watch("count", (count) => calls.push(count));
  source.set("count", 1);
  assert.equal(source.getState().count, 2);
  assert.equal(derived.getState().doubled, 4);
  assert.deepEqual(calls, [1, 2]);
});

test("reentrant store writes do not recurse through the JavaScript stack", () => {
  const source = createStore({ count: 0 });
  source.subscribe(({ count }) => {
    if (count < 10_000) source.set("count", count + 1);
  });
  const derived = computedStore(source, ({ count }) => ({ count }));
  source.set("count", 1);
  assert.equal(source.getState().count, 10_000);
  assert.equal(derived.getState().count, 10_000);
});

test("computed stores can release their source subscription", () => {
  const source = createStore({ count: 0 });
  let selections = 0;
  const derived = computedStore(source, ({ count }) => {
    selections += 1;
    return { count };
  });
  source.set("count", 1);
  assert.equal(derived.getState().count, 1);
  derived.dispose();
  derived.dispose();
  const before = selections;
  source.set("count", 2);
  assert.equal(selections, before);
  assert.equal(derived.getState().count, 1);
});

test("persistence failures do not interrupt store delivery or future writes", () => {
  const source = createStore({ count: 0 });
  let fail = true;
  const saved: string[] = [];
  const unsubscribe = persistStore(source, {
    key: "test",
    storage: {
      getItem: () => null,
      setItem(_key, value) {
        if (fail) throw new Error("quota exceeded");
        saved.push(value);
      }
    }
  });
  const derived = computedStore(source, ({ count }) => ({ count }));
  assert.doesNotThrow(() => source.set("count", 1));
  assert.equal(derived.getState().count, 1);
  fail = false;
  source.set("count", 2);
  assert.deepEqual(saved, ['{"count":2}']);
  unsubscribe();
});

test("persistence tolerates inaccessible storage and invalid saved JSON", () => {
  for (const getItem of [() => { throw new Error("storage blocked"); }, () => "{broken"]) {
    const source = createStore({ count: 0 });
    const saved: string[] = [];
    const unsubscribe = persistStore(source, {
      key: "test",
      storage: { getItem, setItem: (_key, value) => { saved.push(value); } }
    });
    assert.equal(source.getState().count, 0);
    source.set("count", 1);
    assert.deepEqual(saved, ['{"count":1}']);
    unsubscribe();
  }
  const { cleanup } = setupDom();
  try {
    assert.doesNotThrow(() => persistStore(createStore({ count: 0 }), { key: "test" }));
  } finally {
    cleanup();
  }
});

test("persistence serialization errors leave selectors responsive", () => {
  const source = createStore({ count: 0 });
  let saves = 0;
  const unsubscribe = persistStore(source, {
    key: "test",
    storage: { getItem: () => null, setItem() { saves += 1; } },
    serialize() { throw new Error("not serializable"); }
  });
  const counts: number[] = [];
  source.watch("count", (count) => counts.push(count));
  assert.doesNotThrow(() => source.set("count", 1));
  assert.deepEqual(counts, [1]);
  assert.equal(saves, 0);
  unsubscribe();
});
