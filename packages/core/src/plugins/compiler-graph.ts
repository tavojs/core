import { compileInstallations } from "./compiler-installations.js";
import { validateAuthorityDeclarations } from "./authority.js";
import { normalizePluginConfiguration } from "./configuration.js";
import { compileHeadContributions } from "./compiler-head.js";
import {
  allowsReplacement,
  diagnostic,
  EMPTY_CONFIG,
  LOCAL_ID,
  ownedTokenKey,
  publicPath,
  replacementWinner,
  tokenKey,
  validateLocalIds,
} from "./internal.js";
import { orderMiddleware, validateBuildOrdering } from "./ordering.js";
import type {
  CompiledPluginEndpoint,
  CompiledPluginPage,
  CompiledPluginBuildValue,
  CompiledPluginGraph,
  PluginCompileOptions,
  PluginDiagnostic,
  PluginHeadDeclaration,
  PluginMiddlewareDeclaration,
  TavoPluginInput,
} from "./types.js";
import type { PluginMount } from "./configuration-types.js";

export type InternalCompiledPluginGraph = CompiledPluginGraph & {
  mounts: readonly PluginMount[];
};

export function inspectInternal(
  inputConfig: TavoPluginInput = [],
  options: PluginCompileOptions = {},
): {
  graph: InternalCompiledPluginGraph;
  diagnostics: PluginDiagnostic[];
} {
  const diagnostics: PluginDiagnostic[] = [];
  const normalizedConfig = normalizePluginConfiguration(
    inputConfig,
    diagnostics,
  );
  const { config, ordered, owners } = compileInstallations(
    normalizedConfig,
    diagnostics,
  );
  const capabilities = new Map<string, string>();
  const endpoints: CompiledPluginEndpoint[] = [];
  const middleware: Array<PluginMiddlewareDeclaration & { owner: string }> = [];
  const head: Array<PluginHeadDeclaration & { owner: string }> = [];
  const pages = new Map<string, CompiledPluginPage>();
  const singletonHead = new Map<string, string>();
  const buildAliases = new Map<string, CompiledPluginBuildValue>();
  const buildDefines = new Map<string, CompiledPluginBuildValue>();
  for (const item of ordered) {
    const manifest = item.plugin.manifest ?? {};
    validateAuthorityDeclarations(item, diagnostics);
    validateLocalIds(item.owner, "page", manifest.pages, diagnostics);
    validateLocalIds(item.owner, "endpoint", manifest.endpoints, diagnostics);
    validateLocalIds(
      item.owner,
      "middleware",
      manifest.middleware,
      diagnostics,
    );
    validateLocalIds(item.owner, "head", manifest.head, diagnostics);
    validateLocalIds(
      item.owner,
      "build plugin",
      manifest.build?.plugins,
      diagnostics,
    );
    validateBuildOrdering(
      item.owner,
      manifest.build?.plugins ?? [],
      diagnostics,
    );
    const provided = [...(manifest.provides ?? []), ...(manifest.stores ?? [])];
    const localTokens = new Set<string>();
    for (const token of provided) {
      const local = `${token.kind}:${token.name}:${token.scope}`;
      if (token.provider !== item.id || !LOCAL_ID.test(token.name)) {
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_002",
            `Plugin "${item.owner}" declares an invalid or foreign token "${token.provider}:${token.name}".`,
            { resource: tokenKey(token), owners: [item.owner] },
          ),
        );
        continue;
      }
      if (localTokens.has(local))
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Plugin "${item.owner}" declares token "${token.name}" more than once.`,
            { resource: local, owners: [item.owner] },
          ),
        );
      localTokens.add(local);
      capabilities.set(ownedTokenKey(item.owner, token), item.owner);
    }
    for (const requirement of manifest.dependencies ?? []) {
      const providerOwner = (item.dependencies as string[]).find(
        (owner) =>
          owners.get(owner)?.id === requirement.id &&
          (!requirement.instanceId ||
            owners.get(owner)?.instanceId === requirement.instanceId),
      );
      if (!providerOwner && requirement.optional) continue;
      for (const token of requirement.capabilities ?? []) {
        if (
          !providerOwner ||
          !capabilities.has(ownedTokenKey(providerOwner, token))
        ) {
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_004",
              `Plugin "${item.owner}" requires unavailable capability "${token.provider}:${token.name}".`,
              {
                resource: tokenKey(token),
                owners: providerOwner
                  ? [item.owner, providerOwner]
                  : [item.owner],
              },
            ),
          );
        }
      }
    }
    for (const page of manifest.pages ?? []) {
      const path = publicPath(config, item, "page", page.path);
      const previous = pages.get(path);
      if (path.startsWith("/_tavo/") || path === "/_tavo")
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_006",
            `Plugin page "${path}" uses reserved framework URL space.`,
            { resource: path, owners: [item.owner] },
          ),
        );
      if (
        previous &&
        !allowsReplacement(config, "page", path, previous.owner, item.owner)
      )
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Plugin page path "${path}" has multiple owners.`,
            { resource: path, owners: [previous.owner, item.owner] },
          ),
        );
      const appCollision = options.appRoutes?.includes(path) ?? false;
      if (
        appCollision &&
        !allowsReplacement(config, "page", path, item.owner, "app")
      ) {
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Plugin page "${path}" collides with an application route.`,
            { resource: path, owners: [item.owner, "app"] },
          ),
        );
      }
      const pluginWinner = previous
        ? replacementWinner(config, "page", path, previous.owner, item.owner)
        : item.owner;
      const appWinner = appCollision
        ? replacementWinner(config, "page", path, item.owner, "app")
        : item.owner;
      if (pluginWinner === item.owner && appWinner === item.owner) {
        pages.set(path, { ...page, owner: item.owner, path });
      } else if (appWinner === "app") {
        pages.delete(path);
      }
    }
    for (const endpoint of manifest.endpoints ?? []) {
      const path = publicPath(config, item, "server", endpoint.match.path);
      const methods = Array.from(
        new Set(endpoint.methods.map((method) => method.toUpperCase())),
      );
      if (
        methods.length === 0 ||
        methods.some((method) => !/^[A-Z]+$/.test(method))
      )
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_002",
            `Endpoint "${item.owner}:${endpoint.id}" must declare valid HTTP methods.`,
            { owners: [item.owner] },
          ),
        );
      if (path.startsWith("/_tavo/") || path === "/_tavo")
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_006",
            `Plugin endpoint "${path}" uses reserved framework URL space.`,
            { resource: path, owners: [item.owner] },
          ),
        );
      const endpointKey = `${methods.join(",")}:${path}`;
      const appCollision =
        methods.some((method) => method === "GET" || method === "HEAD") &&
        (options.appRoutes ?? []).some((route) =>
          endpoint.match.kind === "exact"
            ? route === path
            : route === path || route.startsWith(`${path}/`),
        );
      if (
        appCollision &&
        !allowsReplacement(config, "endpoint", endpointKey, item.owner, "app")
      ) {
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Plugin endpoint "${path}" collides with an application route.`,
            { resource: path, owners: [item.owner, "app"] },
          ),
        );
      }
      if (
        appCollision &&
        replacementWinner(
          config,
          "endpoint",
          endpointKey,
          item.owner,
          "app",
        ) === "app"
      ) {
        continue;
      }
      for (const previous of endpoints) {
        const sharedMethod = methods.some((method) =>
          previous.methods.includes(method),
        );
        if (
          sharedMethod &&
          previous.path === path &&
          previous.match.kind === endpoint.match.kind &&
          !allowsReplacement(
            config,
            "endpoint",
            `${methods.join(",")}:${path}`,
            previous.owner,
            item.owner,
          )
        ) {
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_003",
              `Plugin endpoint "${path}" has equally specific owners.`,
              { resource: path, owners: [previous.owner, item.owner] },
            ),
          );
        }
      }
      const replacedIndex = endpoints.findIndex(
        (previous) =>
          previous.path === path &&
          previous.match.kind === endpoint.match.kind &&
          methods.some((method) => previous.methods.includes(method)),
      );
      if (replacedIndex < 0) {
        endpoints.push({ ...endpoint, methods, owner: item.owner, path });
      } else {
        const previous = endpoints[replacedIndex]!;
        const winner = replacementWinner(
          config,
          "endpoint",
          endpointKey,
          previous.owner,
          item.owner,
        );
        if (winner === item.owner) {
          endpoints[replacedIndex] = {
            ...endpoint,
            methods,
            owner: item.owner,
            path,
          };
        }
      }
    }
    for (const entry of manifest.middleware ?? [])
      middleware.push({ ...entry, owner: item.owner });
    compileHeadContributions(config, item, head, singletonHead, diagnostics);
    for (const key of Object.keys(manifest.build?.aliases ?? {})) {
      const previous = buildAliases.get(key);
      if (
        previous &&
        !allowsReplacement(config, "alias", key, previous.owner, item.owner)
      )
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Build alias "${key}" has multiple owners.`,
            { resource: key, owners: [previous.owner, item.owner] },
          ),
        );
      const winner = previous
        ? replacementWinner(config, "alias", key, previous.owner, item.owner)
        : item.owner;
      if (winner === item.owner) {
        buildAliases.set(key, {
          owner: item.owner,
          value: manifest.build!.aliases![key]!,
        });
      }
    }
    for (const key of Object.keys(manifest.build?.defines ?? {})) {
      const previous = buildDefines.get(key);
      if (
        previous &&
        !allowsReplacement(config, "define", key, previous.owner, item.owner)
      )
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Build define "${key}" has multiple owners.`,
            { resource: key, owners: [previous.owner, item.owner] },
          ),
        );
      const winner = previous
        ? replacementWinner(config, "define", key, previous.owner, item.owner)
        : item.owner;
      if (winner === item.owner) {
        buildDefines.set(key, {
          owner: item.owner,
          value: manifest.build!.defines![key]!,
        });
      }
    }
  }

  const orderedMiddleware = orderMiddleware(middleware, diagnostics);
  const graph: InternalCompiledPluginGraph = {
    plugins: ordered,
    diagnostics,
    capabilities,
    pages: Array.from(pages.values()),
    endpoints: endpoints.sort((left, right) => {
      if (left.match.kind !== right.match.kind)
        return left.match.kind === "exact" ? -1 : 1;
      return right.path.length - left.path.length;
    }),
    middleware: orderedMiddleware,
    head,
    buildAliases,
    buildDefines,
    mounts: config.mounts ?? [],
    overrides: config.overrides ?? [],
  };
  return { graph, diagnostics };
}
