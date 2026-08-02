import test from "node:test";
import assert from "node:assert/strict";
import {
  compilePattern as compileFrameworkPattern,
  matchCompiledPatternSegments as matchFrameworkPatternSegments
} from "../../src/framework/path-utils.ts";
import {
  compilePattern as compileRouterPattern,
  matchCompiledPatternSegments as matchRouterPatternSegments
} from "../../src/router/path.ts";

const matchers = [
  {
    name: "framework",
    compile: compileFrameworkPattern,
    match: matchFrameworkPatternSegments
  },
  {
    name: "router",
    compile: compileRouterPattern,
    match: matchRouterPatternSegments
  }
] as const;

for (const matcher of matchers) {
  test(`${matcher.name} path matching bounds optional-segment backtracking`, () => {
    const optionalSegments = Array.from({ length: 80 }, (_, index) => `:?p${index}`);
    const compiled = matcher.compile(`/${optionalSegments.join("/")}/required-suffix`);
    const pathParts = Array.from({ length: 80 }, () => "value");

    assert.equal(matcher.match(compiled, pathParts), null);
  });

  test(`${matcher.name} path matching bounds catch-all backtracking`, () => {
    const catchAllSegments = Array.from({ length: 24 }, (_, index) => `*?rest${index}`);
    const compiled = matcher.compile(`/${catchAllSegments.join("/")}/required-suffix`);
    const pathParts = Array.from({ length: 24 }, () => "value");

    assert.equal(matcher.match(compiled, pathParts), null);
  });

  test(`${matcher.name} failed-state memoization preserves successful params`, () => {
    const compiled = matcher.compile("/:?section/*?path/edit/:id");
    const params = matcher.match(compiled, ["docs", "nested", "edit", "42"]);

    assert.deepEqual(params, {
      section: "docs",
      path: "nested",
      id: "42"
    });
  });
}
