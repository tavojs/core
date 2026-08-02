import { registerService } from "../framework/services.js";
import { trackStoreDependency } from "../reactivity.js";
import { createStore } from "../store/index.js";
import type { StoreSelector } from "../store/index.js";
import type {
  AnyI18nService,
  CreateI18nOptions,
  DefinedI18nMessages,
  I18nDetectLocaleInput,
  I18nMessages,
  I18nResolvedPath,
  I18nService,
  I18nState,
  I18nTextValue
} from "./types.js";
import {
  applyBrowserDocumentLocale,
  getRequestHeaders,
  interpolate,
  isRoutingEnabled,
  mergeTextTree,
  normalizePathname,
  pickAcceptedLocale,
  readBrowserCookie,
  readCookie,
  readHeader,
  selectText,
  selectTranslationValue,
  writeBrowserCookie
} from "./helpers.js";

export type {
  CreateI18nOptions,
  DefinedI18nMessages,
  I18nDetectLocaleInput,
  I18nLocaleDirection,
  I18nLocaleInfo,
  I18nMessages,
  I18nMissingKeyPayload,
  I18nParams,
  I18nPrimitive,
  I18nResolvedPath,
  I18nRoutingOptions,
  I18nService,
  I18nSetLocaleOptions,
  I18nState,
  I18nTextTree,
  I18nTextValue,
  I18nTranslationKey,
  AnyI18nService
} from "./types.js";

export const DEFAULT_I18N_SERVICE_NAME = "tavo:i18n";

const i18nRuntimeKey = "__tavo_i18n_runtime__";
const i18nChunkQueueKey = "__tavo_i18n_message_chunks__";
const i18nChunkApplyKey = "__tavo_apply_i18n_message_chunk__";
const requestLocaleResolverKey = "__tavo_i18n_request_locale_resolver__";

type I18nRuntimeState = {
  services: Set<AnyI18nService>;
  pendingChunks: I18nMessages[];
};

function getRequestScopedLocale(service: AnyI18nService): string | undefined {
  const resolver = (globalThis as unknown as Record<string, unknown>)[requestLocaleResolverKey];
  return typeof resolver === "function"
    ? (resolver as (target: AnyI18nService) => string | undefined)(service)
    : undefined;
}

function getI18nRuntimeState(): I18nRuntimeState {
  const target = globalThis as unknown as Record<string, unknown>;
  target[i18nChunkApplyKey] = applyI18nMessageChunk;
  const existing = target[i18nRuntimeKey];
  if (existing) {
    return existing as I18nRuntimeState;
  }
  const queuedChunks = Array.isArray(target[i18nChunkQueueKey])
    ? target[i18nChunkQueueKey] as I18nMessages[]
    : [];
  const created: I18nRuntimeState = {
    services: new Set(),
    pendingChunks: [...queuedChunks]
  };
  target[i18nRuntimeKey] = created;
  target[i18nChunkQueueKey] = [];
  return created;
}

function mergeMessagesIntoService(service: AnyI18nService, messages: I18nMessages): void {
  for (const [locale, text] of Object.entries(messages)) {
    service.setMessages(locale as never, text as never, { merge: true });
  }
}

/** Marks a central translation catalog for build-time i18n splitting. */
export function defineMessages<const TMessages extends I18nMessages>(
  messages: TMessages
): DefinedI18nMessages<TMessages> {
  return messages as DefinedI18nMessages<TMessages>;
}

/** Applies a generated i18n message chunk to every active i18n service. */
export function applyI18nMessageChunk(messages: I18nMessages): void {
  const runtime = getI18nRuntimeState();
  if (runtime.services.size === 0) {
    runtime.pendingChunks.push(messages);
    return;
  }
  for (const service of runtime.services) {
    mergeMessagesIntoService(service, messages);
  }
}

/** Creates a reactive i18n service with direct object access through `i18n.text`. */
export function createI18n<
  TMessages extends I18nMessages,
  TDefaultLocale extends keyof TMessages & string
>(
  options: CreateI18nOptions<TMessages, TDefaultLocale>
): I18nService<TMessages, TDefaultLocale> {
  const fallbackLocale = options.fallbackLocale ?? options.defaultLocale;
  const initialLocale = options.locale ?? options.defaultLocale;
  const locales = Object.keys(options.messages) as Array<keyof TMessages & string>;
  const routing = options.routing === false ? false : options.routing;
  const cookieName = routing && routing.cookieName ? routing.cookieName : "tavo_locale";
  const detectFrom = routing && routing.detectFrom ? routing.detectFrom : ["path", "cookie", "header"];
  const cookieLocale = detectFrom.includes("cookie")
    ? readBrowserCookie(cookieName) as keyof TMessages & string | undefined
    : undefined;
  const store = createStore<I18nState<TMessages>>({
    locale: cookieLocale && locales.includes(cookieLocale) ? cookieLocale : initialLocale,
    fallbackLocale,
    messages: options.messages
  });

  function currentLocale(): keyof TMessages & string {
    return (
      getRequestScopedLocale(service as AnyI18nService) as keyof TMessages & string | undefined
    ) ?? store.getState().locale;
  }

  function currentState(): I18nState<TMessages> {
    const state = store.getState();
    const locale = currentLocale();
    return locale === state.locale ? state : { ...state, locale };
  }

  const service: I18nService<TMessages, TDefaultLocale> = {
    get locale() {
      return currentLocale();
    },
    get defaultLocale() {
      return options.defaultLocale;
    },
    get fallbackLocale() {
      return store.getState().fallbackLocale;
    },
    get locales() {
      return locales;
    },
    get dir() {
      return service.getLocaleInfo(currentLocale()).dir ?? "ltr";
    },
    get messages() {
      return store.getState().messages;
    },
    get text() {
      trackStoreDependency({
        store: store as any,
        selector: selectText as StoreSelector<Record<string, unknown>, unknown>,
        isEqual: Object.is
      });
      return selectText<TMessages, TDefaultLocale>(currentState());
    },
    store,
    setLocale(locale, localeOptions) {
      if (localeOptions?.persist !== false && detectFrom.includes("cookie") && locales.includes(locale)) {
        writeBrowserCookie(cookieName, locale);
      }
      const nextState = store.patch({ locale } as Partial<I18nState<TMessages>>);
      applyBrowserDocumentLocale(locale, options.locales?.[locale]);
      return nextState;
    },
    setMessages(locale, messages, updateOptions) {
      return store.patch((previous) => {
        const previousMessages = previous.messages[locale];
        const nextMessages = updateOptions?.merge && previousMessages
          ? mergeTextTree(previousMessages, messages)
          : messages;

        return {
          messages: {
            ...previous.messages,
            [locale]: nextMessages
          } as TMessages
        };
      });
    },
    getLocaleInfo(locale = currentLocale()) {
      return options.locales?.[locale] ?? {};
    },
    detectLocale(input) {
      const headers = input?.headers ?? getRequestHeaders(input?.request);
      const pathname = input?.pathname;
      if (detectFrom.includes("path") && pathname) {
        const resolvedPath = service.resolvePath(pathname);
        if (resolvedPath.localized && locales.includes(resolvedPath.locale)) {
          return resolvedPath.locale;
        }
      }
      if (detectFrom.includes("cookie")) {
        const cookieHeader = input?.cookie ?? readHeader(headers, "cookie");
        const localeFromCookie = (
          cookieHeader ? readCookie(cookieHeader, cookieName) : readBrowserCookie(cookieName)
        ) as keyof TMessages & string | undefined;
        if (localeFromCookie && locales.includes(localeFromCookie)) {
          return localeFromCookie;
        }
      }
      if (detectFrom.includes("header")) {
        const localeFromHeader = pickAcceptedLocale(readHeader(headers, "accept-language"), locales);
        if (localeFromHeader) {
          return localeFromHeader;
        }
      }
      return options.defaultLocale;
    },
    resolvePath(pathname) {
      const normalized = normalizePathname(pathname);
      if (!isRoutingEnabled(routing)) {
        return {
          pathname: normalized,
          locale: currentLocale(),
          localized: false
        } satisfies I18nResolvedPath<keyof TMessages & string>;
      }
      const [firstSegment = ""] = normalized.slice(1).split("/");
      if (locales.includes(firstSegment as keyof TMessages & string)) {
        const locale = firstSegment as keyof TMessages & string;
        return {
          pathname: normalizePathname(normalized.slice(firstSegment.length + 1) || "/"),
          locale,
          localized: true
        };
      }
      return {
        pathname: normalized,
        locale: currentLocale(),
        localized: false
      };
    },
    localizePath(pathname, locale = currentLocale(), localizeOptions) {
      const normalized = normalizePathname(service.resolvePath(pathname).pathname);
      const shouldPrefixDefault =
        localizeOptions?.includeDefaultLocale ??
        (routing && routing.defaultLocalePrefix === "always");
      if (locale === options.defaultLocale && !shouldPrefixDefault) {
        return normalized;
      }
      return normalizePathname(`/${locale}${normalized}`);
    },
    setLocaleFromRequest(input) {
      return service.setLocale(service.detectLocale(input));
    },
    setLocaleFromPath(pathname) {
      return service.setLocale(service.resolvePath(pathname).locale);
    },
    t(key, params) {
      trackStoreDependency({
        store: store as any,
        selector: ((state: I18nState<TMessages>) => selectTranslationValue(state, key)) as StoreSelector<Record<string, unknown>, unknown>,
        isEqual: Object.is
      });
      const state = currentState();
      const value = selectTranslationValue(state, key);

      if (value === undefined) {
        const replacement = options.onMissingKey?.({
          key,
          locale: state.locale,
          fallbackLocale: state.fallbackLocale
        });
        return replacement ?? key;
      }

      if (typeof value === "string") {
        return interpolate(value, params);
      }

      return String(value);
    },
    subscribe(listener, subscribeOptions) {
      return store.subscribe(listener, subscribeOptions);
    },
    watchLocale(listener, watchOptions) {
      return store.watch("locale", listener, watchOptions);
    }
  };

  if (options.serviceName !== false) {
    registerService(options.serviceName ?? DEFAULT_I18N_SERVICE_NAME, service);
  }

  const runtime = getI18nRuntimeState();
  runtime.services.add(service as AnyI18nService);
  for (const chunk of runtime.pendingChunks) {
    mergeMessagesIntoService(service as AnyI18nService, chunk);
  }
  runtime.pendingChunks = [];
  applyBrowserDocumentLocale(service.locale, service.getLocaleInfo());

  return service;
}
