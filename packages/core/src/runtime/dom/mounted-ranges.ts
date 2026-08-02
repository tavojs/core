import type { MountedNode } from "./types.js";

export function isNonDecreasing(sequence: number[]): boolean {
  let previous = -1;
  for (const value of sequence) {
    if (value < 0 || value < previous) {
      return false;
    }
    previous = value;
  }
  return true;
}

export function moveMountedRange(parent: Node, mounted: MountedNode, before: Node | null): void {
  if (mounted.start === before) {
    return;
  }

  if (mounted.start === mounted.end) {
    parent.insertBefore(mounted.start, before);
    return;
  }

  const fragment = document.createDocumentFragment();
  let current: Node | null = mounted.start;
  while (current) {
    const nextSibling: Node | null = current.nextSibling;
    fragment.appendChild(current);
    if (current === mounted.end) {
      break;
    }
    current = nextSibling;
  }
  parent.insertBefore(fragment, before);
}

export function longestIncreasingSubsequence(sequence: number[]): number[] {
  const length = sequence.length;
  const predecessors = new Array<number>(length).fill(-1);
  const tails: number[] = [];

  for (let i = 0; i < length; i += 1) {
    const value = sequence[i];
    if (value < 0) {
      continue;
    }

    let left = 0;
    let right = tails.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (sequence[tails[mid]] < value) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    if (left > 0) {
      predecessors[i] = tails[left - 1];
    }

    if (left === tails.length) {
      tails.push(i);
    } else {
      tails[left] = i;
    }
  }

  const lis: number[] = [];
  if (tails.length === 0) {
    return lis;
  }

  let cursor = tails[tails.length - 1];
  while (cursor >= 0) {
    lis.push(cursor);
    cursor = predecessors[cursor];
  }
  lis.reverse();
  return lis;
}
