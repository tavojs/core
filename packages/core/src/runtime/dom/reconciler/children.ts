import type { Child } from "../../../jsx.js";
import { removeMounted } from "../cleanup.js";
import { getDomRuntimeConfig } from "../config.js";
import {
  assertStrictKeys,
  getChildKey,
  hasAnyKey
} from "../child-utils.js";
import {
  isNonDecreasing,
  longestIncreasingSubsequence,
  moveMountedRange
} from "../mounted-ranges.js";
import type { MountedNode } from "../types.js";
import type { MountOperations, RenderEnv } from "./context.js";

export function reconcileChildList(
  parent: Node,
  previous: MountedNode[],
  nextChildren: Child[],
  before: Node | null,
  env: RenderEnv,
  operations: MountOperations
): MountedNode[] {
  const runtime = getDomRuntimeConfig();
  const keyedMode = runtime.keyedStrategy === "strict" || hasAnyKey(nextChildren);

  if (!keyedMode) {
    if (previous.length === 0 && nextChildren.length === 0) {
      return previous;
    }
    const nextMounted: MountedNode[] = [];
    const maxLength = Math.max(previous.length, nextChildren.length);

    for (let index = 0; index < maxLength; index += 1) {
      const previousChild = previous[index];
      const nextChild = nextChildren[index];

      if (previousChild && nextChild !== undefined) {
        nextMounted.push(operations.patchNode(parent, previousChild, nextChild, env));
        continue;
      }

      if (previousChild && nextChild === undefined) {
        removeMounted(parent, previousChild);
        continue;
      }

      if (!previousChild && nextChild !== undefined) {
        nextMounted.push(operations.mountNode(parent, before, nextChild, env));
      }
    }

    return nextMounted;
  }

  if (runtime.keyedStrategy === "strict") {
    assertStrictKeys(nextChildren);
  }

  if (previous.length === nextChildren.length) {
    let stableByKey = true;
    for (let index = 0; index < previous.length; index += 1) {
      if (!Object.is(previous[index].key, getChildKey(nextChildren[index]))) {
        stableByKey = false;
        break;
      }
    }
    if (stableByKey) {
      const nextMounted = new Array<MountedNode>(nextChildren.length);
      for (let index = 0; index < nextChildren.length; index += 1) {
        nextMounted[index] = operations.patchNode(parent, previous[index], nextChildren[index], env);
      }
      return nextMounted;
    }
  }

  const nextMounted: MountedNode[] = [];
  const matchedPreviousIndexes: number[] = [];
  const used = new Set<number>();
  const keyedPrevious = new Map<string | number, number>();
  const unkeyedPreviousIndexes: number[] = [];

  for (let index = 0; index < previous.length; index += 1) {
    const previousKey = previous[index].key;
    if (previousKey === null) {
      unkeyedPreviousIndexes.push(index);
      continue;
    }
    keyedPrevious.set(previousKey, index);
  }

  let unkeyedCursor = 0;

  for (const nextChild of nextChildren) {
    const nextKey = getChildKey(nextChild);
    let previousIndex = -1;

    if (nextKey !== null) {
      const matchedIndex = keyedPrevious.get(nextKey);
      if (matchedIndex !== undefined && !used.has(matchedIndex)) {
        previousIndex = matchedIndex;
      }
    } else {
      while (unkeyedCursor < unkeyedPreviousIndexes.length) {
        const candidate = unkeyedPreviousIndexes[unkeyedCursor];
        unkeyedCursor += 1;
        if (!used.has(candidate)) {
          previousIndex = candidate;
          break;
        }
      }
    }

    let mounted: MountedNode;
    if (previousIndex >= 0) {
      used.add(previousIndex);
      mounted = operations.patchNode(parent, previous[previousIndex], nextChild, env);
    } else {
      mounted = operations.mountNode(parent, before, nextChild, env);
    }

    matchedPreviousIndexes.push(previousIndex);
    nextMounted.push(mounted);
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (!used.has(index)) {
      removeMounted(parent, previous[index]);
    }
  }

  if (matchedPreviousIndexes.length > 0 && isNonDecreasing(matchedPreviousIndexes)) {
    return nextMounted;
  }

  const optimizeMoves = nextMounted.length >= runtime.keyedLargeListOptimizationThreshold;
  if (!optimizeMoves) {
    for (let index = nextMounted.length - 1; index >= 0; index -= 1) {
      const nextAnchor = index + 1 < nextMounted.length ? nextMounted[index + 1].start : before;
      moveMountedRange(parent, nextMounted[index], nextAnchor);
    }
    return nextMounted;
  }

  const lis = longestIncreasingSubsequence(matchedPreviousIndexes);
  const stable = new Set<number>(lis);

  for (let index = nextMounted.length - 1; index >= 0; index -= 1) {
    const nextAnchor = index + 1 < nextMounted.length ? nextMounted[index + 1].start : before;
    if (matchedPreviousIndexes[index] !== -1 && stable.has(index)) {
      continue;
    }
    moveMountedRange(parent, nextMounted[index], nextAnchor);
  }

  return nextMounted;
}
