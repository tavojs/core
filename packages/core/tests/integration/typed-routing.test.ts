import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../../src/index.tsx";
import {
  createPagesManifestDetailed,
  createPagesRuntimeAsync,
  defineRoutePage,
  type RouteParamsFromPath
} from "../../src/framework/index.ts";
import { TavoError } from "../../src/diagnostics.ts";

test("defineRoutePage preserves runtime page module shape", () => {
  const page = defineRoutePage<"/blog/[id]", { title: string }>("/blog/[id]", {
    static: true,
    load: () => ({ title: "Hello" }),
    default: (props) => h("main", null, `${props.params.id}:${props.data?.title}`)
  });

  assert.equal(typeof page.default, "function");
  assert.equal(typeof page.load, "function");
  assert.equal(page.static, true);
});

test("manifest rejects named prerender combined with helper static", () => {
  const helperPage = defineRoutePage("/conflict", {
    static: true,
    default: () => h("main", null, "conflict")
  });

  assert.throws(
    () => createPagesManifestDetailed({
      "/src/pages/conflict.tsx": {
        prerender: true,
        default: helperPage
      } as any
    }),
    (error: unknown) => {
      assert.ok(error instanceof TavoError);
      assert.equal(error.code, "TAVO_PAGES_006");
      assert.match(error.message, /declares both prerender and static/);
      return true;
    }
  );
});

test("lazy manifest rejects named prerender combined with helper static", async () => {
  const loader = Object.assign(
    async () => ({
      prerender: false,
      default: defineRoutePage("/lazy-conflict", {
        static: true,
        default: () => h("main", null, "lazy conflict")
      })
    }),
    { __tavo_loader__: true as const }
  );
  const runtime = await createPagesRuntimeAsync({
    "/src/pages/lazy-conflict.tsx": loader as any
  });

  await assert.rejects(
    runtime.resolvePathAsync("/lazy-conflict"),
    (error: unknown) => {
      assert.ok(error instanceof TavoError);
      assert.equal(error.code, "TAVO_PAGES_006");
      return true;
    }
  );
});

test("RouteParamsFromPath can be used as a typed params contract", () => {
  const params: RouteParamsFromPath<"/files/[...all]/[[section]]"> = {
    all: "a/b",
    section: undefined
  };

  assert.equal(params.all, "a/b");
  assert.equal(params.section, undefined);
});
