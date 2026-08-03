# Validation

> Online guide:
> [tavojs.dev/docs/core/actions-and-forms](https://tavojs.dev/docs/core/actions-and-forms)

Tavo.js integrates with schema libraries through the Standard Schema interface and common `safeParse`/`parse` contracts. No validator is required by the framework.

## Validate Values

```ts
import { validateInput } from "@tavojs/core/dev";

const result = await validateInput(userSchema, input);
if (!result.ok) {
  console.log(result.issues);
}
```

This works with Standard Schema-compatible libraries. It also adapts validators exposing `safeParseAsync`, `safeParse`, `parseAsync`, or `parse`.

## Validated Route Actions

`defineValidatedAction()` parses JSON or form input, validates it, and passes typed input to the handler:

```tsx
import { defineValidatedAction } from "@tavojs/core/dev";

export const action = defineValidatedAction(userSchema, async ({ input, request }) => {
  const user = await createUser(input);
  return {
    status: 201,
    json: { id: user.id },
  };
});
```

Invalid input returns HTTP 400:

```json
{
  "error": "validation_failed",
  "issues": [
    { "message": "Invalid email", "path": ["email"] }
  ]
}
```

Validation does not replace authorization, CSRF/origin protection, database constraints, or output escaping. Perform authorization inside the action after validation and before changing state.
