import type { NodeHandlerOptions } from "../ssr/index.js";
import type { TavoPluginInput } from "../plugins/index.js";

export type ViteEsbuildOptions = Record<string, unknown> & {
  jsx?: string;
  jsxImportSource?: string;
};

export type TavoViteConfig = Record<string, unknown> & {
  esbuild?: ViteEsbuildOptions | false;
};

export type TavoViteConfigEnv = Record<string, unknown> & {
  command?: string;
  mode?: string;
  isPreview?: boolean;
  isSsrBuild?: boolean;
};

export type TavoViteConfigExport =
  | TavoViteConfig
  | Promise<TavoViteConfig>
  | ((env: TavoViteConfigEnv) => TavoViteConfig | Promise<TavoViteConfig>);

export type TavoConfig = {
  pagesDir?: string;
  cssEntries?: string[];
  plugins?: TavoPluginInput;
  diagnostics?: {
    devOverlay?: boolean;
    traces?: boolean;
  };
  build?: {
    prerenderStyles?: "inline" | "external";
    budgets?: {
      firstLoadJs?: number | string;
      routeJs?: number | string;
    };
  };
  ssr?: Omit<NodeHandlerOptions, "modules" | "plugins"> & {
    modules?: NodeHandlerOptions["modules"];
  };
};

export type ExactTavoConfig<T extends TavoConfig> = T & {
  [K in Exclude<keyof T, keyof TavoConfig>]: never;
};
