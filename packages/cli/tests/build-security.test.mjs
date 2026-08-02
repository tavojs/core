import assert from "node:assert/strict";
import test from "node:test";
import { safeOutputPathSegments } from "../dist/cli/commands/build.mjs";

function createSeededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomPathname(random) {
  const alphabet = [
    "alpha",
    "nested",
    "file",
    "%25",
    "%2e",
    "%2e%2e",
    "%2F",
    "%5C",
    "a%2Fb",
    "a%5Cb",
    "%E0%A4%A"
  ];
  const count = 1 + Math.floor(random() * 5);
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(alphabet[Math.floor(random() * alphabet.length)]);
  }
  return `/${parts.join("/")}`;
}

function isExpectedSafe(pathname) {
  try {
    return pathname
      .split("/")
      .filter(Boolean)
      .every((segment) => {
        const decoded = decodeURIComponent(segment);
        return decoded.length > 0 &&
          decoded !== "." &&
          decoded !== ".." &&
          !decoded.includes("/") &&
          !decoded.includes("\\");
      });
  } catch {
    return false;
  }
}

test("build security: prerender output paths reject encoded separators and traversal segments", () => {
  assert.deepEqual(safeOutputPathSegments("/"), []);
  assert.deepEqual(safeOutputPathSegments("/blog/alpha"), ["blog", "alpha"]);
  assert.deepEqual(safeOutputPathSegments("/blog/%25literal"), ["blog", "%literal"]);

  assert.equal(safeOutputPathSegments("/blog/%2e%2e"), null);
  assert.equal(safeOutputPathSegments("/blog/.."), null);
  assert.equal(safeOutputPathSegments("/blog/.%2Fsecret"), null);
  assert.equal(safeOutputPathSegments("/blog/a%2Fb"), null);
  assert.equal(safeOutputPathSegments("/blog/a%5Cb"), null);
  assert.equal(safeOutputPathSegments("/blog/%E0%A4%A"), null);
});

test("build security: deterministic fuzzing keeps prerender output paths segment-safe", () => {
  const random = createSeededRandom(0x51a7e);

  for (let index = 0; index < 150; index += 1) {
    const pathname = randomPathname(random);
    const result = safeOutputPathSegments(pathname);
    if (isExpectedSafe(pathname)) {
      assert.ok(Array.isArray(result), pathname);
      assert.equal(result.join("/").includes(".."), false, pathname);
      assert.equal(result.join("/").includes("\\"), false, pathname);
    } else {
      assert.equal(result, null, pathname);
    }
  }
});
