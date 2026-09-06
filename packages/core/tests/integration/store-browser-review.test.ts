import test from "node:test";
import assert from "node:assert/strict";
import { createStore as createCoreStore } from "../../src/store/core.ts";
import { createStore as createBrowserStore } from "../../src/store/browser.ts";
import { computedStore } from "../../src/store/extras.ts";

for (const [name, createStore] of [["core", createCoreStore], ["browser", createBrowserStore]] as const) {
  test(`${name} store preserves snapshot order through nested subscriber writes`, () => {
    const source = createStore({ n: 0 });
    source.watch("n", (n: number) => { if (n === 1) source.set("n", 2); });
    const derived = computedStore(source, (state) => ({ n: state.n }));
    const observed: number[] = [];
    source.subscribeSelector((state) => state.n, (n) => observed.push(n));
    source.set("n", 1);
    assert.equal(source.getState().n, 2);
    assert.equal(derived.getState().n, 2);
    assert.deepEqual(observed, [1, 2]);
    derived.dispose();
  });
}
