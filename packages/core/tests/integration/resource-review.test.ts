import test from "node:test";
import assert from "node:assert/strict";
import { createResource } from "../../src/resources/index.ts";

test("resource preload retries after a synchronous loader failure", async () => {
  let calls = 0;
  const resource = createResource<string>(() => {
    if (++calls === 1) throw new Error("temporary failure");
    return Promise.resolve("recovered");
  });
  assert.equal((await resource.preload()).status, "error");
  assert.equal((await resource.preload()).data, "recovered");
  assert.equal(calls, 2);
});

test("pre-aborted resource loads never invoke the loader", async () => {
  let calls = 0;
  const resource = createResource(async () => {
    calls += 1;
    throw new Error("should not run");
  });
  const result = await resource.preload({ signal: AbortSignal.abort() });
  assert.equal(result.status, "idle");
  assert.equal(calls, 0);
});

test("resource preload shares work while pending and handles abort during the loader", async () => {
  const controller = new AbortController();
  let calls = 0;
  const resource = createResource(async () => {
    calls += 1;
    controller.abort();
    throw new Error("cancelled work");
  });
  const first = resource.preload({ signal: controller.signal });
  assert.equal(first, resource.preload());
  assert.equal((await first).status, "idle");
  assert.equal(calls, 1);
});
