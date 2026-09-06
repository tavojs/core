# AI Evaluation

> Online automation guide: [tavojs.dev/docs/cli/automation](https://tavojs.dev/docs/cli/automation)

Tavo.js treats correctness per token as a release metric for its machine protocol.

## Certified Corpus

The CLI package ships a versioned corpus of 45 tasks across small, medium, large, TypeScript, and
mixed JavaScript/TypeScript applications. It covers route and component authoring, loaders,
validated actions, stores, styling and accessibility, and diagnostic repair.

Run the deterministic gate with:

```bash
npm run test:agent
```

The gate validates the corpus and schemas, then measures the real CLI against a 100-route fixture.
Compact context must remain at or below 8 KB, cold inspection below 500 ms, and cached inspection
below 200 ms. Those timing targets are hard limits during local release verification. GitHub-hosted
runners report target misses without failing because shared CPU and filesystem contention makes
absolute wall-clock limits nondeterministic. Set `TAVO_ENFORCE_PERFORMANCE=1` on controlled CI
hardware to enforce the local limits there too.

## Optional Live Model Experiments

Live adapters export a provider-neutral contract:

```js
export const model = "provider/model";

export async function runTask(task) {
  // task.fixtureDefinition describes the required seeded application profile.
  return {
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    retries: 0,
    invalidEdits: 0,
    firstPass: false,
    repaired: false,
    durationMs: 0
  };
}
```

Run an adapter with `npm --workspace @tavojs/cli run eval:live -- ./adapter.mjs report.json`.
The adapter owns its credentials and provider SDKs. This harness is opt-in and is not part of the
automated CI or release gates. When comparing model or tool ecosystems, run at least two adapters
against the same corpus and retain their JSON reports outside the repository.

## Release Thresholds

- First-pass success: at least 90%.
- Success after one repair cycle: at least 95%.
- Headline efficiency: successful tasks per 10,000 total input and output tokens.

Offline checks run on every pull request. Live model results are experimental and must not block
development or releases unless a separately maintained evaluation system aggregates repeated runs.
