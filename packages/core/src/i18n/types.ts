import type { Store, StoreListener, StoreWatchListener, Unsubscribe } from "../store/index.js";

export type I18nPrimitive = string | number | boolean | null;
export type I18nTextValue = I18nPrimitive | I18nTextTree | readonly I18nTextValue[];
export type I18nTextTree = {
  readonly [key: string]: I18nTextValue;
};
export type I18nMessages = Record<string, I18nTextTree>;
export type I18nParams = Record<string, string | number | boolean | null | undefined>;
type StringKeyOf<T> = Extract<keyof T, string>;

export type I18nTranslationKey<TTree> = TTree extends I18nTextTree
  ? {
      [K in StringKeyOf<TTree>]: TTree[K] extends I18nTextTree
        ? `${K}` | `${K}.${I18nTranslationKey<TTree[K]>}`
        : `${K}`;
    }[StringKeyOf<TTree>]
  : never;

export type I18nLocaleDirection = "ltr" | "rtl" | "auto";

export type I18nLocaleInfo = {
  label?: string;
  dir?: I18nLocaleDirection;
};

export type I18nRoutingOptions = {
  enabled?: boolean;
  defaultLocalePrefix?: "always" | "never";
  cookieName?: string;
  detectFrom?: Array<"path" | "cookie" | "header">;
};

export type I18nResolvedPath<TLocale extends string = string> = {
  pathname: string;
  locale: TLocale;
  localized: boolean;
};

export type I18nDetectLocaleInput = {
  pathname?: string;
  request?: unknown;
  headers?: Headers | Record<string, string | string[] | undefined>;
  cookie?: string;
};

export type I18nMissingKeyPayload = {
  key: string;
  locale: string;
  fallbackLocale: string;
};

export type I18nState<TMessages extends I18nMessages> = {
  locale: keyof TMessages & string;
  fallbackLocale: keyof TMessages & string;
  messages: TMessages;
};

export type CreateI18nOptions<
  TMessages extends I18nMessages,
  TDefaultLocale extends keyof TMessages & string
> = {
  defaultLocale: TDefaultLocale;
  locale?: keyof TMessages & string;
  fallbackLocale?: keyof TMessages & string;
  messages: TMessages;
  locales?: Partial<Record<keyof TMessages & string, I18nLocaleInfo>>;
  routing?: false | I18nRoutingOptions;
  serviceName?: string | false;
  onMissingKey?: (payload: I18nMissingKeyPayload) => string | void;
};

export type DefinedI18nMessages<TMessages extends I18nMessages> = TMessages & {
  readonly __tavo_defined_messages__?: true;
};

export type I18nSetLocaleOptions = {
  persist?: boolean;
};

export type I18nService<
  TMessages extends I18nMessages,
  TDefaultLocale extends keyof TMessages & string
> = {
  readonly locale: keyof TMessages & string;
  readonly defaultLocale: TDefaultLocale;
  readonly fallbackLocale: keyof TMessages & string;
  readonly locales: Array<keyof TMessages & string>;
  readonly dir: I18nLocaleDirection;
  readonly messages: TMessages;
  readonly text: TMessages[TDefaultLocale];
  readonly store: Store<I18nState<TMessages>>;
  setLocale(locale: keyof TMessages & string, options?: I18nSetLocaleOptions): I18nState<TMessages>;
  setMessages(locale: keyof TMessages & string, messages: TMessages[keyof TMessages], options?: { merge?: boolean }): I18nState<TMessages>;
  getLocaleInfo(locale?: keyof TMessages & string): I18nLocaleInfo;
  detectLocale(input?: I18nDetectLocaleInput): keyof TMessages & string;
  resolvePath(pathname: string): I18nResolvedPath<keyof TMessages & string>;
  localizePath(pathname: string, locale?: keyof TMessages & string, options?: { includeDefaultLocale?: boolean }): string;
  setLocaleFromRequest(input?: I18nDetectLocaleInput): I18nState<TMessages>;
  setLocaleFromPath(pathname: string): I18nState<TMessages>;
  t(key: I18nTranslationKey<TMessages[TDefaultLocale]>, params?: I18nParams): string;
  t(key: string, params?: I18nParams): string;
  subscribe(listener: StoreListener<I18nState<TMessages>>, options?: { immediate?: boolean }): Unsubscribe;
  watchLocale(
    listener: StoreWatchListener<keyof TMessages & string, I18nState<TMessages>>,
    options?: { immediate?: boolean }
  ): Unsubscribe;
};

export type AnyI18nService = I18nService<any, string>;
