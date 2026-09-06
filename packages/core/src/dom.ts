// Public DOM runtime entrypoint.
// The implementation lives under src/runtime/dom/* to keep concerns isolated.
export {
  createRoot,
  render,
  type CheckedRoot,
  type Root,
  type RootOptions,
  type RootRenderFailure,
  type RootRenderOutcome,
  type RootRenderSuccess
} from "./runtime/dom/root.js";
