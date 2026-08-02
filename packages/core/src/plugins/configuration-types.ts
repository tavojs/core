import type { TavoPlugin } from "./types.js";

export type PluginInstallation = {
  plugin: TavoPlugin;
  instanceId?: string;
  enabled?: boolean;
};

export type PluginMount = {
  plugin: string;
  instanceId?: string;
  kind: "page" | "server";
  from?: string;
  to: string;
};

export type PluginOverride = {
  kind: "page" | "endpoint" | "head" | "alias" | "define";
  key: string;
  replace: { plugin: string; instanceId?: string };
  with: { owner: "app" | string; instanceId?: string; key?: string };
};

export type PluginPermission = {
  plugin: string;
  instanceId?: string;
  unsafeHeadHtml?: boolean;
};

export type PluginExposureTarget =
  | string
  | {
      from?: string;
      to: string;
    };

/** Application-owned ergonomic installation record. */
export type PluginUse =
  | TavoPlugin
  | (PluginInstallation & {
      /** Remaps this installation's manifest-declared public exposure. */
      expose?: {
        page?: PluginExposureTarget;
        server?: PluginExposureTarget;
      };
    });

export type PluginUseConfiguration = {
  use: readonly PluginUse[];
  overrides?: readonly PluginOverride[];
};

export type PluginConfiguration = {
  installs: readonly PluginInstallation[];
  mounts?: readonly PluginMount[];
  overrides?: readonly PluginOverride[];
  permissions?: readonly PluginPermission[];
};

/** Author input; normalized to the compiler's internal graph configuration. */
export type TavoPluginInput =
  | PluginUseConfiguration
  | readonly PluginUse[];
