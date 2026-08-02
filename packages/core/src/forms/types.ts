import type { Action, ActionState } from "../actions/index.js";
import type { ActionContentType } from "../framework/types.js";
import type { TavoBootMode } from "../auto-pages/types.js";
import type { Store } from "../store/index.js";

export type FormValues = Record<string, FormDataEntryValue | FormDataEntryValue[]>;

export type FormState<TResult = unknown> = ActionState<TResult> & {
  values: FormValues;
};

export type FormAction<TResult = unknown> = {
  action: Action<FormValues, TResult>;
  store: Store<FormState<TResult>>;
  submit(form: HTMLFormElement | FormData | FormValues): Promise<FormState<TResult>>;
  reset(): void;
};

export type ServerFormActionBodyContext = {
  bootMode: TavoBootMode;
  url: string;
};

export type ServerFormActionBodyValue =
  | "form-data"
  | "json"
  | ((values: FormValues, context: ServerFormActionBodyContext) => BodyInit | Promise<BodyInit>);

export type ServerFormActionBody =
  | ServerFormActionBodyValue
  | Partial<Record<TavoBootMode | "default", ServerFormActionBodyValue>>;

export type ServerFormActionContentType =
  | ActionContentType
  | Partial<Record<TavoBootMode | "default", ActionContentType>>;

export type ServerFormActionOptions<TResult = unknown> = {
  body?: ServerFormActionBody;
  contentType?: ServerFormActionContentType;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  method?: string;
  parseResponse?: (response: Response) => Promise<TResult> | TResult;
};
