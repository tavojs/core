import { createAction, type Action, type ActionState } from "../actions/index.js";
import { getTavoBootMode } from "../auto-pages/bootstrap.js";
import { getActivePagesRuntime } from "../auto-pages/state.js";
import { createStore, type Store } from "../store/index.js";
import type {
  FormAction,
  FormState,
  FormValues,
  ServerFormActionBody,
  ServerFormActionBodyContext,
  ServerFormActionBodyValue,
  ServerFormActionContentType,
  ServerFormActionOptions
} from "./types.js";

export type {
  FormAction,
  FormState,
  FormValues,
  ServerFormActionBody,
  ServerFormActionBodyContext,
  ServerFormActionBodyValue,
  ServerFormActionContentType,
  ServerFormActionOptions
} from "./types.js";

/** Converts browser FormData into a plain object while preserving repeated field names. */
export function formDataToObject(formData: FormData): FormValues {
  const values: FormValues = {};
  for (const [key, value] of formData.entries()) {
    const existing = values[key];
    if (existing === undefined) {
      values[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values[key] = [existing, value];
    }
  }
  return values;
}

/** Creates a form-oriented action for MVC controllers without introducing hook-style APIs. */
export function createFormAction<TResult = unknown>(
  handler: (values: FormValues, context: { signal: AbortSignal }) => Promise<TResult> | TResult
): FormAction<TResult> {
  const action = createAction<FormValues, TResult>(({ input, signal }) =>
    handler(input, { signal })
  );
  const store = createStore<FormState<TResult>>({
    ...action.getState(),
    values: {}
  });

  action.store.subscribe((state) => {
    store.patch(state);
  });

  function readValues(form: HTMLFormElement | FormData | FormValues): FormValues {
    if (typeof FormData !== "undefined" && form instanceof FormData) {
      return formDataToObject(form);
    }
    if (typeof HTMLFormElement !== "undefined" && form instanceof HTMLFormElement) {
      return formDataToObject(new FormData(form));
    }
    return form as FormValues;
  }

  return {
    action,
    store,
    async submit(form) {
      const values = readValues(form);
      store.patch({ values });
      await action.run(values);
      store.patch(action.getState());
      return store.getState();
    },
    reset() {
      action.reset();
      store.setState({
        ...action.getState(),
        values: {}
      });
    }
  };
}

async function defaultParseServerFormResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`tavo form: server action failed with status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function valuesToFormData(values: FormValues): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, item);
      }
    } else {
      formData.append(key, value);
    }
  }
  return formData;
}

function resolveServerFormBodyValue(
  body: ServerFormActionBody | undefined,
  context: ServerFormActionBodyContext
): ServerFormActionBodyValue {
  if (!body || typeof body === "string" || typeof body === "function") {
    return body ?? "form-data";
  }
  return body[context.bootMode] ?? body.default ?? "form-data";
}

function resolveServerFormContentType(
  contentType: ServerFormActionContentType | undefined,
  context: ServerFormActionBodyContext
): ServerFormActionBodyValue | undefined {
  if (!contentType || typeof contentType === "string") {
    return contentType;
  }
  return contentType[context.bootMode] ?? contentType.default;
}

async function resolveServerFormBody(values: FormValues, body: ServerFormActionBodyValue, context: ServerFormActionBodyContext): Promise<BodyInit> {
  if (body === "form-data") {
    return valuesToFormData(values);
  }
  if (body === "json") {
    return JSON.stringify(values);
  }
  return body(values, context);
}

function resolveServerFormHeaders(headers: HeadersInit | undefined, body: ServerFormActionBodyValue): HeadersInit | undefined {
  if (body !== "json") {
    return headers;
  }
  const resolved = new Headers(headers);
  if (!resolved.has("content-type")) {
    resolved.set("content-type", "application/json");
  }
  return resolved;
}

/** Creates a form action that submits to an SSR route action endpoint. */
export function createServerFormAction<TResult = unknown>(
  url: string,
  options: ServerFormActionOptions<TResult> = {}
): FormAction<TResult> {
  const submitter = options.fetch ?? fetch;
  return createFormAction<TResult>(async (values, { signal }) => {
    const context = {
      bootMode: getTavoBootMode(),
      url
    };
    const bodyOption = resolveServerFormBodyValue(
      options.body ?? resolveServerFormContentType(options.contentType, context),
      context
    );
    const body = await resolveServerFormBody(values, bodyOption, context);
    const actionUrl = getActivePagesRuntime()?.router.canonicalize(url) ?? url;
    const response = await submitter(actionUrl, {
      method: options.method ?? "POST",
      headers: resolveServerFormHeaders(options.headers, bodyOption),
      body,
      credentials: options.credentials ?? "same-origin",
      signal
    });
    if (response.redirected && typeof window !== "undefined") {
      window.location.assign(response.url);
    }
    const parser = options.parseResponse ?? defaultParseServerFormResponse;
    return parser(response) as Promise<TResult> | TResult;
  });
}
