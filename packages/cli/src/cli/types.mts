export type CliFlagValue = string | boolean;
export type CliFlags = Record<string, CliFlagValue>;

export type ParsedCliArgs = {
  positionals: string[];
  flags: CliFlags;
};

export type FileWriteOptions = {
  force?: boolean;
};

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | string;

export type BuildFlags = CliFlags & {
  "report-json"?: CliFlagValue;
  "prerender-styles"?: CliFlagValue;
};

export type BuildReportRow = {
  symbol: "ƒ" | "○";
  route: string;
  mode?: string;
  size: number;
  firstLoadJs: number;
};

export type BuildReport = {
  rows: BuildReportRow[];
};

export type RollupChunkOutput = {
  type: "chunk";
  fileName: string;
  code?: string;
  imports?: string[];
  isEntry?: boolean;
  modules?: Record<string, { renderedLength?: number }>;
};

export type RollupAssetOutput = {
  type: "asset";
  fileName?: string;
};

export type RollupBuildOutput = RollupChunkOutput | RollupAssetOutput;

export type ViteBuildResult =
  | { output?: RollupBuildOutput[] }
  | Array<{ output?: RollupBuildOutput[] }>
  | null
  | undefined;

export type ViteManifestEntry = {
  file?: string;
  css?: string[];
  imports?: string[];
  isDynamicEntry?: boolean;
  isEntry?: boolean;
  src?: string;
};

export type ClientAssetPlan = {
  clientEntryScript: string;
  moduleCss: Record<string, string[]>;
  sharedCss: string[];
};

export type MonitorFlags = CliFlags & {
  url?: CliFlagValue;
  once?: CliFlagValue;
  json?: CliFlagValue;
  interval?: CliFlagValue;
  token?: CliFlagValue;
};

export type GeneratorOptions = FileWriteOptions & {
  packageManager?: PackageManager;
  loader?: boolean;
  seo?: boolean;
  props?: boolean;
  shape?: string;
  dryRun?: boolean;
  typedRoute?: boolean;
};

export type ResolvedPageTarget = {
  target: string;
  routeName: string;
  componentName: string;
};

export type ResolvedNamedFolderTarget = {
  target: string;
  name: string;
  normalized: string;
};

export type MonitorPayload = {
  server?: {
    mode?: string;
    pid?: number;
    uptimeSeconds?: number;
  };
  requests?: {
    total?: number;
    inflight?: number;
    errors?: number;
    averageRenderDurationMs?: number;
    lastRenderDurationMs?: number | null;
    maxRenderDurationMs?: number;
    cacheHits?: number;
    cacheMisses?: number;
    cacheEntries?: number;
    staticAssetHits?: number;
    lastRequestAt?: string | null;
    topRoutes?: Array<{ pathname: string; hits: number }>;
  };
  process?: {
    rss?: number;
    heapUsed?: number;
    heapTotal?: number;
    cpuUserMicros?: number;
    cpuSystemMicros?: number;
    loadAverage?: number[];
  };
};
