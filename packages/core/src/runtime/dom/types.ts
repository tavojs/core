import type { Child, Component } from "../../jsx.js";
import type { StoreDependency } from "../../reactivity.js";
import type { ErrorBoundaryFallback, TavoContext } from "../../components/index.js";
import type { ElementCleanup } from "../../elements/index.js";
import type { Unsubscribe } from "../../store/index.js";
import type { ComponentRuntimeState } from "./component-runtime.js";

export type RootDependencySubscription = StoreDependency & {
  unsubscribe: Unsubscribe;
};
export type RenderContextMap = Map<symbol, unknown>;

export type MountedText = {
  kind: "text";
  key: string | number | null;
  start: Text;
  end: Text;
  node: Text;
  value: string;
};

export type MountedEmpty = {
  kind: "empty";
  key: string | number | null;
  start: Text;
  end: Text;
};

export type MountedElement = {
  kind: "element";
  key: string | number | null;
  start: Element;
  end: Element;
  node: Element;
  tag: string;
  props: Record<string, unknown>;
  children: MountedNode[];
  directivesCleanup: ElementCleanup | null;
};

export type MountedFragment = {
  kind: "fragment";
  key: string | number | null;
  start: Text;
  end: Text;
  children: MountedNode[];
};

export type MountedComponent = {
  kind: "component";
  key: string | number | null;
  start: Text;
  end: Text;
  type: Component;
  props: Record<string, unknown>;
  child: MountedNode | null;
  dependencies: RootDependencySubscription[];
  runtime: ComponentRuntimeState;
  context: RenderContextMap;
  boundary: MountedErrorBoundary | null;
  unmounted: boolean;
  isRendering: boolean;
  queued: boolean;
  performRender: () => void;
  rerender: () => void;
};

export type MountedProvider = {
  kind: "provider";
  key: string | number | null;
  start: Text;
  end: Text;
  contextRef: TavoContext<unknown>;
  value: unknown;
  child: MountedNode | null;
  context: RenderContextMap;
  boundary: MountedErrorBoundary | null;
};

export type MountedErrorBoundary = {
  kind: "error-boundary";
  key: string | number | null;
  start: Text;
  end: Text;
  fallback: ErrorBoundaryFallback;
  resetKey: unknown;
  children: Child;
  child: MountedNode | null;
  error: unknown;
  context: RenderContextMap;
  parentBoundary: MountedErrorBoundary | null;
  captureError: (error: unknown) => void;
  renderBoundary: () => void;
};

export type MountedNode =
  | MountedText
  | MountedEmpty
  | MountedElement
  | MountedFragment
  | MountedComponent
  | MountedProvider
  | MountedErrorBoundary;

export type HydrateResult = {
  mounted: MountedNode;
  cursor: Node | null;
};

/** Successful checked root commit. */
export type RootRenderSuccess = Readonly<{ ok: true }>;
/** Failed checked root commit with the original render error. */
export type RootRenderFailure = Readonly<{ ok: false; error: unknown }>;
export type RootRenderOutcome = RootRenderSuccess | RootRenderFailure;

export type RootOptions = Readonly<{
  /** Receives uncaught root-scoped render failures without replacing the checked outcome. */
  onError?: (error: unknown) => void;
}>;

/** Source-compatible root lifecycle API. Roots returned by `createRoot` are `CheckedRoot`s. */
export type Root = {
  render(node: Child): void;
  hydrate(node: Child): void;
  unmount(): void;
};

/** A root created by `createRoot`, with observable commit outcomes. */
export type CheckedRoot = Root & {
  /** Commits a tree and reports failure after releasing any partial root state. */
  renderChecked(node: Child): RootRenderOutcome;
  /** Hydrates a tree and reports failure after releasing any partial root state. */
  hydrateChecked(node: Child): RootRenderOutcome;
};
