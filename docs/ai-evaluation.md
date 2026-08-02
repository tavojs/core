# AI Evaluation

> Online automation guide: [tavojs.dev/docs/cli/automation](https://tavojs.dev/docs/cli/automation)

Tavo treats correctness per token as a release metric for its machine protocol.

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
below 200 ms.

## Live Models

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

Run an adapter with `npm --workspace tavo run eval:live -- ./adapter.mjs report.json`.
Use at least two model/tool ecosystems nightly and before a release. Credentials and provider SDKs
belong to the adapter, not Tavo.

The included GitHub workflow reads repository-relative adapter modules from
`TAVO_AGENT_ADAPTER_A` and `TAVO_AGENT_ADAPTER_B`, with credentials supplied through the matching
`TAVO_AGENT_API_KEY_A` and `TAVO_AGENT_API_KEY_B` secrets. It rejects missing or duplicate adapters.

## Release Thresholds

- First-pass success: at least 90%.
- Success after one repair cycle: at least 95%.
- Headline efficiency: successful tasks per 10,000 total input and output tokens.

Offline checks run on every pull request. Live results are repeated and trended so one
nondeterministic run does not block development; release certification uses the aggregate threshold.
