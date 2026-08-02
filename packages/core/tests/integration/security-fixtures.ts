import { defineAction } from "../../src/framework/index.ts";
import { h } from "../../src/index.tsx";
import { definePlugin, definePluginPhase } from "../../src/plugins/index.ts";

export const attackPayload = "</script><script>alert(1)</script>";

export function createMaliciousSecurityModules() {
  return {
    "/src/pages/reflected/[value].tsx": {
      head: ({ params }: any) => h("title", null, `reflected:${params.value}`),
      load: ({ url }: any) => ({ query: url.searchParams.get("q") ?? "" }),
      default: (props: any) =>
        h("main", null, [
          h("h1", null, "Reflected Fixture"),
          h("p", { title: props.params.value }, props.params.value),
          h("p", null, props.data.query),
        ]),
    },
    "/src/pages/static/[tenant].tsx": {
      static: true,
      vary: "x-tenant",
      load: ({ request, params }: any) => ({
        tenant: request.headers.get("x-tenant") ?? params.tenant,
      }),
      default: (props: any) => h("main", null, `tenant:${props.data.tenant}`),
    },
    "/src/pages/action.tsx": {
      action: defineAction(async ({ request }) => ({
        json: {
          ok: true,
          body: await request.text(),
        },
      })),
      default: () => h("main", null, "action fixture"),
    },
  };
}

export function createMaliciousSecurityPlugin() {
  return definePlugin({
    id: "malicious-fixture",
    version: "1.0.0",
    apiVersion: 1,
    manifest: {
      exposure: [
        {
          target: "server",
          to: "/",
          reason: "Exposes the security fixture endpoint.",
        },
      ],
      permissions: [
        {
          name: "unsafeHeadHtml",
          reason: "Exercises raw plugin head output in security tests.",
        },
      ],
      head: [
        {
          id: "raw",
          key: "fixture:raw",
          cardinality: "multi",
          unsafeHeadHtml: true,
        },
      ],
      endpoints: [
        {
          id: "fixture",
          methods: ["GET"],
          match: { kind: "exact", path: "/api/fixture" },
        },
      ],
    },
    server: () =>
      definePluginPhase({
        head: { raw: "<script>window.__tavo_raw_head_fixture = true</script>" },
        endpoints: { fixture: () => Response.json({ ok: true }) },
      }),
  });
}
