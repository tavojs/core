import test from "node:test";
import assert from "node:assert/strict";
import {
  h,
  renderToString,
  TavoController,
  createTavo,
} from "../../src/index.tsx";
import { createPagesRuntimeAsync } from "../../src/framework/index.ts";
import { setActivePagesRuntime } from "../../src/auto-pages/state.ts";
import {
  TAVO_PLUGIN_API_VERSION,
  checkPluginCompatibility,
  defineCapability,
  definePlugin,
  definePluginPhase,
  definePluginStore,
  type TavoPlugin,
  type TavoPluginInput,
} from "../../src/plugins/index.ts";
import {
  compilePluginGraph,
  inspectPluginGraph,
} from "../../src/plugins/compiler.ts";
import { normalizePluginConfiguration } from "../../src/plugins/configuration.ts";
import { handlePluginRequest } from "../../src/plugins/request.ts";
import { createPluginRuntimeAsync } from "../../src/plugins/runtime.ts";

function plugin(
  id: string,
  manifest: TavoPlugin["manifest"] = {},
  phases: Pick<TavoPlugin, "client" | "server" | "build"> = {},
): TavoPlugin {
  return definePlugin({
    id,
    version: "1.0.0",
    apiVersion: TAVO_PLUGIN_API_VERSION,
    manifest,
    ...phases,
  });
}

function config(...plugins: TavoPlugin[]): readonly TavoPlugin[] {
  return plugins;
}

function diagnosticText(configuration: TavoPluginInput): string {
  return inspectPluginGraph(configuration)
    .diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
    .join("\n");
}

test("plugin API v1 compiles an immutable, inspectable ownership graph", () => {
  const clock = defineCapability<{ now(): number }>({
    provider: "@acme/clock",
    name: "clock",
    scope: "runtime",
  });
  const graph = compilePluginGraph(
    config(plugin("@acme/clock", { provides: [clock] })),
  );
  const inspection = inspectPluginGraph(
    config(plugin("@acme/clock", { provides: [clock] })),
  );

  assert.equal(TAVO_PLUGIN_API_VERSION, 1);
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(inspection.valid, true);
  assert.deepEqual(inspection.plugins, [
    {
      owner: "@acme/clock#default",
      id: "@acme/clock",
      instanceId: "default",
      version: "1.0.0",
      dependencies: [],
    },
  ]);
  assert.deepEqual(inspection.capabilities, [
    {
      key: "@acme/clock#default|capability|clock|runtime",
      owner: "@acme/clock#default",
    },
  ]);

  assert.equal(Object.isFrozen(graph.capabilities), true);
  assert.equal("set" in graph.capabilities, false);
  assert.throws(
    () => (graph.capabilities as Map<string, string>).set("forged", "attacker"),
    /set|function/i,
  );
  assert.equal(graph.capabilities.has("forged"), false);
});

test("plugin compatibility accepts API 1 and rejects other versions", () => {
  const supported = checkPluginCompatibility({
    id: "@acme/supported",
    apiVersion: 1,
  });
  const unsupported = checkPluginCompatibility({
    id: "@acme/unsupported",
    apiVersion: 2,
  });

  assert.deepEqual(
    {
      compatible: supported.compatible,
      currentVersion: supported.currentVersion,
      requestedVersion: supported.requestedVersion,
    },
    { compatible: true, currentVersion: 1, requestedVersion: 1 },
  );
  assert.equal(unsupported.compatible, false);
  assert.equal(unsupported.currentVersion, 1);
  assert.equal(unsupported.requestedVersion, 2);
  assert.equal(unsupported.diagnostic?.code, "TAVO_PLUGIN_001");
});

test("incompatible and missing plugin API versions fail before phase loading", async () => {
  let phaseLoads = 0;
  const incompatible = {
    id: "@acme/incompatible",
    version: "1.0.0",
    apiVersion: 2,
    manifest: {},
    server: async () => {
      phaseLoads += 1;
      return definePluginPhase({});
    },
  } as unknown as TavoPlugin;
  const missing = {
    id: "@acme/missing-version",
    version: "1.0.0",
    manifest: {},
  } as unknown as TavoPlugin;

  await assert.rejects(
    createPluginRuntimeAsync([incompatible]),
    /targets API 2.*supports API 1/i,
  );
  assert.equal(phaseLoads, 0);

  const inspection = inspectPluginGraph([missing]);
  assert.equal(inspection.valid, false);
  assert.equal(inspection.diagnostics[0]?.code, "TAVO_PLUGIN_001");
});

test("plugin installation enables manifest-declared permissions and exposure", () => {
  const analytics = plugin("@acme/analytics", {
    permissions: [
      {
        name: "unsafeHeadHtml",
        required: true,
        reason: "Injects the validated analytics bootstrap script.",
      },
    ],
    head: [
      {
        id: "bootstrap",
        key: "analytics:bootstrap",
        cardinality: "singleton",
        unsafeHeadHtml: true,
      },
    ],
  });
  const sitemap = plugin("@acme/sitemap", {
    exposure: [
      {
        target: "server",
        from: "/",
        to: "/",
        reason: "Publishes sitemap.xml at the site root.",
      },
    ],
    endpoints: [
      {
        id: "sitemap",
        methods: ["GET", "HEAD"],
        match: { kind: "exact", path: "/sitemap.xml" },
      },
    ],
  });
  const input = [analytics, sitemap] as const;
  const graph = compilePluginGraph(input);

  assert.deepEqual(
    graph.plugins.map((entry) => entry.owner),
    ["@acme/analytics#default", "@acme/sitemap#default"],
  );
  assert.equal(graph.endpoints[0]?.path, "/sitemap.xml");
  const inspection = inspectPluginGraph(input);
  assert.deepEqual(inspection.mounts, [
    {
      owner: "@acme/sitemap#default",
      target: "server",
      from: "/",
      to: "/",
    },
  ]);
  assert.deepEqual(inspection.permissions, [
    {
      owner: "@acme/analytics#default",
      name: "unsafeHeadHtml",
      required: true,
      reason: "Injects the validated analytics bootstrap script.",
    },
  ]);
  assert.deepEqual(inspection.exposure, [
    {
      owner: "@acme/sitemap#default",
      target: "server",
      from: "/",
      to: "/",
      reason: "Publishes sitemap.xml at the site root.",
    },
  ]);
  assert.equal("config" in graph, false);
  assert.equal("mounts" in graph, false);
});

test("application exposure remaps manifest defaults and disabled uses omit authority", () => {
  const simple = plugin("@acme/simple");
  const disabled = plugin("@acme/disabled", {
    permissions: [
      {
        name: "unsafeHeadHtml",
        reason: "Disabled permission.",
      },
    ],
    exposure: [
      {
        target: "page",
        to: "/disabled",
        reason: "Disabled exposure.",
      },
    ],
  });
  const normalized = normalizePluginConfiguration([
    simple,
    {
      plugin: disabled,
      enabled: false,
      expose: { page: "/" },
    },
  ]);

  assert.equal(
    compilePluginGraph([simple]).plugins[0]?.owner,
    "@acme/simple#default",
  );
  assert.equal(normalized.installs.length, 2);
  assert.equal(normalized.mounts, undefined);
  assert.equal(normalized.permissions, undefined);

  const publicPlugin = plugin("@acme/public", {
    exposure: [
      {
        target: "server",
        to: "/",
        reason: "Default public API.",
      },
    ],
  });
  assert.equal(
    normalizePluginConfiguration([
      { plugin: publicPlugin, expose: { server: "/custom" } },
    ]).mounts?.[0]?.to,
    "/custom",
  );
});

test("ergonomic use configuration preserves advanced owner-aware overrides", () => {
  const contributed = plugin("@acme/page", {
    pages: [{ id: "dashboard", path: "/dashboard" }],
  });
  const graph = compilePluginGraph(
    {
      use: [{ plugin: contributed, expose: { page: "/" } }],
      overrides: [
        {
          kind: "page",
          key: "/dashboard",
          replace: { plugin: "@acme/page" },
          with: { owner: "app" },
        },
      ],
    },
    { appRoutes: ["/dashboard"] },
  );

  assert.equal(graph.pages.length, 0);
  assert.equal(graph.overrides.length, 1);
});

test("plugin manifests reject unknown permissions", () => {
  const candidate = plugin("@acme/unknown-permission", {
    permissions: [
      {
        name: "readAllSecrets",
        reason: "Must never be accepted.",
      },
    ],
  } as any);
  const inspection = inspectPluginGraph([candidate]);

  assert.equal(inspection.valid, false);
  assert.match(
    inspection.diagnostics.map((entry) => entry.message).join("\n"),
    /invalid.*permission/i,
  );
});

test("malformed authority declarations produce diagnostics instead of throwing", () => {
  const candidate = plugin("@acme/malformed-authority", {
    permissions: [undefined, { name: "unsafeHeadHtml", reason: 42 }],
    exposure: [undefined, { target: "server", to: "/", reason: 42 }],
  } as any);

  const inspection = inspectPluginGraph([candidate]);
  assert.equal(inspection.valid, false);
  assert.match(
    inspection.diagnostics.map((entry) => entry.message).join("\n"),
    /invalid.*permission|invalid.*exposure/i,
  );
});

test("duplicate default installations are fatal while named instances are isolated", () => {
  const reusable = plugin("@acme/reusable");
  const duplicate = { use: [reusable, reusable] };

  assert.equal(inspectPluginGraph(duplicate).valid, false);
  assert.match(
    diagnosticText(duplicate),
    /duplicate|installed more than once/i,
  );
  assert.throws(() => compilePluginGraph(duplicate), /plugin|duplicate/i);

  const graph = compilePluginGraph({
    use: [
      { plugin: reusable, instanceId: "primary" },
      { plugin: reusable, instanceId: "secondary" },
      { plugin: reusable, instanceId: "disabled", enabled: false },
    ],
  });
  assert.deepEqual(
    graph.plugins.map((entry) => entry.owner),
    ["@acme/reusable#primary", "@acme/reusable#secondary"],
  );
});

test("required dependencies are versioned, optional dependencies may be absent, and cycles fail", () => {
  const required = plugin("@acme/consumer", {
    dependencies: [{ id: "@acme/provider", version: "^2.0.0" }],
  });
  const optional = plugin("@acme/optional-consumer", {
    dependencies: [{ id: "@acme/missing", version: "^1.0.0", optional: true }],
  });

  assert.equal(inspectPluginGraph(config(required)).valid, false);
  assert.match(
    diagnosticText(config(required)),
    /missing.*@acme\/provider|@acme\/provider.*missing/i,
  );
  assert.equal(inspectPluginGraph(config(optional)).valid, true);

  const incompatible = plugin("@acme/provider");
  const incompatibleConfig = config(incompatible, required);
  assert.equal(inspectPluginGraph(incompatibleConfig).valid, false);
  assert.match(
    diagnosticText(incompatibleConfig),
    /requires.*\^2\.0\.0.*1\.0\.0.*installed/i,
  );

  const first = plugin("@acme/first", {
    dependencies: [{ id: "@acme/second", version: "*" }],
  });
  const second = plugin("@acme/second", {
    dependencies: [{ id: "@acme/first", version: "*" }],
  });
  const cyclic = config(first, second);
  assert.equal(inspectPluginGraph(cyclic).valid, false);
  assert.match(diagnosticText(cyclic), /cycle|circular/i);
});

test("capability dependencies must name the provider and declared token", () => {
  const clock = defineCapability<{ now(): number }>({
    provider: "@acme/clock",
    name: "clock",
    scope: "runtime",
  });
  const privateClock = defineCapability<{ now(): number }>({
    provider: "@acme/clock",
    name: "private-clock",
    scope: "runtime",
  });
  const provider = plugin("@acme/clock", { provides: [clock, privateClock] });
  const allowed = plugin("@acme/allowed", {
    dependencies: [
      { id: "@acme/clock", version: "^1.0.0", capabilities: [clock] },
    ],
  });
  const undeclared = plugin("@acme/undeclared", {
    dependencies: [
      {
        id: "@acme/clock",
        version: "^1.0.0",
        capabilities: [
          defineCapability({
            provider: "@acme/clock",
            name: "missing",
            scope: "runtime",
          }),
        ],
      },
    ],
  });

  assert.equal(inspectPluginGraph(config(provider, allowed)).valid, true);
  const invalid = config(provider, undeclared);
  assert.equal(inspectPluginGraph(invalid).valid, false);
  assert.match(
    diagnosticText(invalid),
    /capability.*missing|missing.*capability/i,
  );
});

test("store hydration contracts are validated during preflight", () => {
  assert.throws(
    () =>
      definePluginStore<{ count: number }>({
        provider: "@acme/counter",
        name: "counter",
        hydrate: true,
      }),
    /hydrate|serializ|deserializ|validat/i,
  );

  const validStore = definePluginStore<{ count: number }>({
    provider: "@acme/counter",
    name: "counter",
    hydrate: true,
    serialize: (value) => value,
    deserialize: (value) => value as { count: number },
    validate: (value): value is { count: number } =>
      Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as { count?: unknown }).count === "number",
      ),
  });
  assert.equal(
    inspectPluginGraph(
      config(plugin("@acme/counter", { stores: [validStore] })),
    ).valid,
    true,
  );
});

test("hydrated stores serialize, restore, and reject invalid payloads", async () => {
  const counter = definePluginStore<{ count: number }>({
    provider: "@acme/hydration",
    name: "counter",
    hydrate: true,
    serialize: (value) => ({ encodedCount: String(value.count) }),
    deserialize: (value) => ({
      count: Number((value as { encodedCount?: unknown }).encodedCount),
    }),
    validate: (value): value is { count: number } =>
      Boolean(
        value &&
        typeof value === "object" &&
        Number.isFinite((value as { count?: unknown }).count),
      ),
  });
  const hydrated = plugin(
    "@acme/hydration",
    { stores: [counter] },
    {
      server: () =>
        definePluginPhase({ stores: { counter: () => ({ count: 1 }) } }),
    },
  );
  const source = await createPluginRuntimeAsync(config(hydrated));
  source.capabilities.resolve(counter).setState({ count: 42 });

  const payload = source.serializeHydrationState();
  assert.deepEqual(payload, {
    "@acme/hydration#default:counter": { encodedCount: "42" },
  });

  const target = await createPluginRuntimeAsync(config(hydrated));
  target.hydrate(payload);
  assert.deepEqual(target.capabilities.resolve(counter).getState(), {
    count: 42,
  });
  assert.throws(
    () =>
      target.hydrate({
        "@acme/hydration#default:counter": { encodedCount: "not-a-number" },
      }),
    /hydration.*invalid|invalid.*hydration/i,
  );
  assert.throws(() => target.hydrate([]), /must be an object/i);

  await source.dispose();
  await target.dispose();
});

test("endpoint collisions are fatal, while methods and matcher specificity are deterministic", () => {
  const collision = config(
    plugin("@acme/api", {
      endpoints: [
        {
          id: "one",
          methods: ["GET"],
          match: { kind: "exact", path: "/items" },
        },
        {
          id: "two",
          methods: ["GET"],
          match: { kind: "exact", path: "/items" },
        },
      ],
    }),
  );
  assert.equal(inspectPluginGraph(collision).valid, false);
  assert.match(diagnosticText(collision), /endpoint|collision|overlap/i);

  const graph = compilePluginGraph(
    config(
      plugin("@acme/api", {
        endpoints: [
          {
            id: "tree",
            methods: ["GET"],
            match: { kind: "subtree", path: "/items" },
          },
          {
            id: "exact",
            methods: ["GET"],
            match: { kind: "exact", path: "/items/special" },
          },
          {
            id: "post",
            methods: ["POST"],
            match: { kind: "exact", path: "/items/special" },
          },
        ],
      }),
    ),
  );
  assert.deepEqual(
    graph.endpoints.map((endpoint) => endpoint.id),
    ["exact", "post", "tree"],
  );
  assert.ok(
    graph.endpoints.every((endpoint) => endpoint.path.startsWith("/_plugins/")),
  );
});

test("framework paths remain reserved even when an application supplies a public mount", () => {
  const api = plugin("@acme/api", {
    exposure: [
      {
        target: "server",
        to: "/_tavo/extensions",
        reason: "Exercises reserved framework URL validation.",
      },
    ],
    endpoints: [
      {
        id: "health",
        methods: ["GET"],
        match: { kind: "exact", path: "/health" },
      },
    ],
  });
  const configuration = [api] as const;

  assert.equal(inspectPluginGraph(configuration).valid, false);
  assert.match(diagnosticText(configuration), /reserved|_tavo/i);
});

test("head singleton ownership collides, multi entries compose, and unsafe HTML needs permission", () => {
  const first = plugin("@acme/first", {
    head: [{ id: "title", key: "document:title", cardinality: "singleton" }],
  });
  const second = plugin("@acme/second", {
    head: [{ id: "title", key: "document:title", cardinality: "singleton" }],
  });
  assert.equal(inspectPluginGraph(config(first, second)).valid, false);

  const multiA = plugin("@acme/a", {
    head: [{ id: "preload", key: "preload", cardinality: "multi" }],
  });
  const multiB = plugin("@acme/b", {
    head: [{ id: "preload", key: "preload", cardinality: "multi" }],
  });
  assert.equal(inspectPluginGraph(config(multiA, multiB)).valid, true);

  const unsafe = plugin("@acme/unsafe", {
    permissions: [
      {
        name: "unsafeHeadHtml",
        reason: "Renders a trusted analytics bootstrap.",
      },
    ],
    head: [
      {
        id: "raw",
        key: "raw:analytics",
        cardinality: "multi",
        unsafeHeadHtml: true,
      },
    ],
  });
  assert.equal(inspectPluginGraph([unsafe]).valid, true);

  const undeclaredUnsafe = plugin("@acme/undeclared-unsafe", {
    head: [
      {
        id: "raw",
        key: "raw:undeclared",
        cardinality: "multi",
        unsafeHeadHtml: true,
      },
    ],
  });
  assert.equal(inspectPluginGraph([undeclaredUnsafe]).valid, false);
  const forgedStrictConfiguration = {
    installs: [{ plugin: undeclaredUnsafe }],
    permissions: [
      { plugin: "@acme/undeclared-unsafe", unsafeHeadHtml: true },
    ],
  } as unknown as TavoPluginInput;
  assert.equal(
    inspectPluginGraph(forgedStrictConfiguration).valid,
    false,
  );
});

test("a head implementation cannot return raw HTML without declaring it", async () => {
  const undeclared = plugin(
    "@acme/undeclared-html",
    {
      head: [{ id: "meta", key: "meta:description", cardinality: "multi" }],
    },
    {
      server: () =>
        definePluginPhase({
          head: { meta: '<meta name="description" content="unsafe">' },
        }),
    },
  );

  await assert.rejects(
    createPluginRuntimeAsync(config(undeclared), { phase: "server" }),
    /raw HTML without declaring unsafeHeadHtml/,
  );
});

test("owner-aware overrides reject stale owners and allow the exact declared replacement", () => {
  const first = plugin("@acme/first", {
    head: [{ id: "title", key: "document:title", cardinality: "singleton" }],
  });
  const second = plugin("@acme/second", {
    head: [{ id: "title", key: "document:title", cardinality: "singleton" }],
  });
  const exact: TavoPluginInput = {
    use: [first, second],
    overrides: [
      {
        kind: "head",
        key: "document:title",
        replace: { plugin: "@acme/first" },
        with: { owner: "@acme/second" },
      },
    ],
  };
  assert.equal(inspectPluginGraph(exact).valid, true);
  assert.deepEqual(
    compilePluginGraph(exact).head.map((entry) => entry.owner),
    ["@acme/second#default"],
  );

  const stale: TavoPluginInput = {
    use: [first],
    overrides: [
      {
        kind: "head",
        key: "document:title",
        replace: { plugin: "@acme/missing" },
        with: { owner: "@acme/first" },
      },
    ],
  };
  assert.equal(inspectPluginGraph(stale).valid, false);
  assert.match(diagnosticText(stale), /override|missing|owner/i);
});

test("application routes require an explicit app override and remove the plugin page winner", async () => {
  const pagePlugin = plugin(
    "@acme/page",
    {
      pages: [{ id: "conflict", path: "/conflict" }],
    },
    {
      server: () =>
        definePluginPhase({
          pages: { conflict: () => h("main", null, "plugin") },
        }),
    },
  );
  const modules = {
    "/src/pages/conflict.tsx": { default: () => h("main", null, "app") },
  };
  const base: TavoPluginInput = {
    use: [{ plugin: pagePlugin, expose: { page: "/" } }],
  };

  await assert.rejects(
    () => createPagesRuntimeAsync(modules, { plugins: base }),
    /collides with an application route/i,
  );

  const runtime = await createPagesRuntimeAsync(modules, {
    plugins: {
      ...base,
      overrides: [
        {
          kind: "page",
          key: "/conflict",
          replace: { plugin: "@acme/page" },
          with: { owner: "app" },
        },
      ],
    },
  });
  assert.equal(runtime.pluginRuntime.graph.pages.length, 0);
  assert.equal(
    runtime.routes.filter((route) => route.path === "/conflict").length,
    1,
  );
});

test("page middleware stages run before and after application middleware", async () => {
  const calls: string[] = [];
  const staged = plugin(
    "@acme/staged",
    {
      middleware: [
        { id: "before", target: "page", stage: "page:before-app" },
        { id: "after", target: "page", stage: "page:after-app" },
      ],
    },
    {
      server: () =>
        definePluginPhase({
          middleware: {
            before: () => {
              calls.push("before");
            },
            after: () => {
              calls.push("after");
            },
          },
        }),
    },
  );
  const runtime = await createPagesRuntimeAsync(
    {
      "/src/pages/index.tsx": { default: () => h("main", null, "home") },
    },
    {
      plugins: config(staged),
      middleware: [
        () => {
          calls.push("app");
        },
      ],
    },
  );

  await runtime.resolvePathAsync("/");
  assert.deepEqual(calls, ["before", "app", "after"]);
});

test("preflight failure never imports or executes a phase", async () => {
  let phaseLoads = 0;
  let setupCalls = 0;
  const duplicate = plugin(
    "@acme/failing",
    {},
    {
      server: async () => {
        phaseLoads += 1;
        return definePluginPhase({
          setup() {
            setupCalls += 1;
          },
        });
      },
    },
  );

  await assert.rejects(
    createPluginRuntimeAsync({
      use: [duplicate, duplicate],
    }),
    /plugin|duplicate/i,
  );
  assert.equal(phaseLoads, 0);
  assert.equal(setupCalls, 0);
});

test("phase implementations must exactly match the manifest declarations", async () => {
  const missing = plugin(
    "@acme/mismatch",
    {
      endpoints: [
        {
          id: "health",
          methods: ["GET"],
          match: { kind: "exact", path: "/health" },
        },
      ],
    },
    {
      server: async () => definePluginPhase({ endpoints: {} }),
    },
  );

  await assert.rejects(
    createPluginRuntimeAsync(config(missing)),
    /health|implementation|manifest/i,
  );
});

test("runtime and request capability scopes are isolated and disposed", async () => {
  let runtimeCreations = 0;
  let requestCreations = 0;
  let disposals = 0;
  const runtimeClock = defineCapability<{ id: number }>({
    provider: "@acme/scopes",
    name: "runtime-clock",
    scope: "runtime",
  });
  const requestClock = defineCapability<{ id: number }>({
    provider: "@acme/scopes",
    name: "request-clock",
    scope: "request",
  });
  const scoped = plugin(
    "@acme/scopes",
    { provides: [runtimeClock, requestClock] },
    {
      server: async () =>
        definePluginPhase({
          capabilities: {
            "runtime-clock": () => ({ id: ++runtimeCreations }),
            "request-clock": () => ({ id: ++requestCreations }),
          },
          dispose() {
            disposals += 1;
          },
        }),
    },
  );
  const runtime = await createPluginRuntimeAsync(config(scoped));

  assert.equal(
    runtime.capabilities.resolve(runtimeClock),
    runtime.capabilities.resolve(runtimeClock),
  );
  const first = runtime.createRequestScope(
    new Request("https://example.test/one"),
  );
  const second = runtime.createRequestScope(
    new Request("https://example.test/two"),
  );
  assert.equal(
    await first.resolve(requestClock),
    await first.resolve(requestClock),
  );
  assert.notEqual(
    await first.resolve(requestClock),
    await second.resolve(requestClock),
  );
  assert.equal(runtimeCreations, 1);
  assert.equal(requestCreations, 2);

  await first.dispose();
  await second.dispose();
  await runtime.dispose();
  assert.equal(disposals, 1);
});

test("a plugin can resolve only the capability tokens explicitly declared on its dependency", async () => {
  const allowed = defineCapability<{ visibility: "allowed" }>({
    provider: "@acme/provider",
    name: "allowed",
    scope: "runtime",
  });
  const privateToken = defineCapability<{ visibility: "private" }>({
    provider: "@acme/provider",
    name: "private",
    scope: "runtime",
  });
  const provider = plugin(
    "@acme/provider",
    { provides: [allowed, privateToken] },
    {
      server: () =>
        definePluginPhase({
          capabilities: {
            allowed: () => ({ visibility: "allowed" as const }),
            private: () => ({ visibility: "private" as const }),
          },
        }),
    },
  );
  const consumer = plugin(
    "@acme/consumer",
    {
      dependencies: [
        { id: "@acme/provider", version: "^1.0.0", capabilities: [allowed] },
      ],
    },
    {
      server: () =>
        definePluginPhase({
          setup(context) {
            assert.equal(context.resolve(allowed).visibility, "allowed");
            context.resolve(privateToken);
          },
        }),
    },
  );

  await assert.rejects(
    createPluginRuntimeAsync(config(provider, consumer)),
    /undeclared|private|capability/i,
  );
});

test("request factories cannot escape their declared dependency capability set", async () => {
  const secret = defineCapability<{ value: string }>({
    provider: "@acme/victim",
    name: "secret",
    scope: "runtime",
  });
  const exploit = defineCapability<{ value: string }>({
    provider: "@acme/attacker",
    name: "exploit",
    scope: "request",
  });
  const victim = plugin(
    "@acme/victim",
    { provides: [secret] },
    {
      server: () =>
        definePluginPhase({
          capabilities: { secret: () => ({ value: "sensitive" }) },
        }),
    },
  );
  const attacker = plugin(
    "@acme/attacker",
    { provides: [exploit] },
    {
      server: () =>
        definePluginPhase({
          capabilities: { exploit: (context) => context.resolve(secret) },
        }),
    },
  );
  const runtime = await createPluginRuntimeAsync(config(victim, attacker));
  const scope = runtime.createRequestScope(
    new Request("https://example.test/"),
  );

  await assert.rejects(
    scope.resolve(exploit),
    /undeclared|provider|capability/i,
  );
  await scope.dispose();
  await runtime.dispose();
});

test("request resources stay alive through streaming and dispose after close or cancellation", async () => {
  let creations = 0;
  let disposals = 0;
  const resource = defineCapability<{ id: number; dispose(): void }>({
    provider: "@acme/streaming",
    name: "resource",
    scope: "request",
  });
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const streaming = plugin(
    "@acme/streaming",
    {
      provides: [resource],
      exposure: [
        {
          target: "server",
          to: "/",
          reason: "Publishes the streaming test endpoint.",
        },
      ],
      endpoints: [
        {
          id: "stream",
          methods: ["GET"],
          match: { kind: "exact", path: "/stream" },
        },
      ],
    },
    {
      server: () =>
        definePluginPhase({
          capabilities: {
            resource: () => ({
              id: ++creations,
              dispose: () => {
                disposals += 1;
              },
            }),
          },
          endpoints: {
            stream: async (context) => {
              await context.resolve(resource);
              return new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controllers.push(controller);
                    controller.enqueue(new TextEncoder().encode("chunk"));
                  },
                }),
              );
            },
          },
        }),
    },
  );
  const runtime = await createPluginRuntimeAsync([streaming]);

  const consumed = await handlePluginRequest(
    runtime,
    new Request("https://example.test/stream"),
  );
  assert.ok(consumed?.body);
  const consumedReader = consumed.body.getReader();
  assert.equal(
    new TextDecoder().decode((await consumedReader.read()).value),
    "chunk",
  );
  assert.equal(disposals, 0);
  controllers.shift()!.close();
  assert.equal((await consumedReader.read()).done, true);
  assert.equal(disposals, 1);

  const cancelled = await handlePluginRequest(
    runtime,
    new Request("https://example.test/stream"),
  );
  assert.ok(cancelled?.body);
  const cancelledReader = cancelled.body.getReader();
  await cancelledReader.cancel("client disconnected");
  assert.equal(disposals, 2);
  assert.equal(creations, 2);

  await runtime.dispose();
});

test("MVC controllers resolve plugin capabilities from the active pages runtime", async () => {
  const greeting = defineCapability<{ text: string }>({
    provider: "@acme/mvc",
    name: "greeting",
    scope: "runtime",
  });
  const mvcPlugin = plugin(
    "@acme/mvc",
    { provides: [greeting] },
    {
      server: () =>
        definePluginPhase({
          capabilities: { greeting: () => ({ text: "hello from plugin" }) },
        }),
    },
  );
  const runtime = await createPagesRuntimeAsync(
    {
      "/src/pages/index.tsx": { default: () => h("main", null, "home") },
    },
    {
      plugins: [mvcPlugin],
    },
  );
  class CapabilityController extends TavoController {
    message() {
      return this.capabilities.resolve(greeting).text;
    }
  }
  const CapabilityView = createTavo({
    controller: CapabilityController,
    view: ({ controller }) => h("p", null, controller?.message()),
  });

  setActivePagesRuntime(runtime);
  try {
    assert.equal(
      renderToString(h(CapabilityView, {})),
      "<p>hello from plugin</p>",
    );
  } finally {
    setActivePagesRuntime(null);
    await runtime.pluginRuntime.dispose();
  }
});
