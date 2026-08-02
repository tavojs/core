import type { GlobalServiceRegistry } from "./types.js";

const warnedSsrServices = new Set<string>();
const warnedDuplicateServices = new Set<string>();

export type ServiceKey<T> = {
  readonly name: string;
  readonly __tavoServiceType?: T;
};

export type ServiceIdentifier<T = unknown> = string | ServiceKey<T>;

export type RegisterServiceOptions = {
  override?: boolean;
};

/** Creates a typed key for registering and resolving a named service. */
export function createServiceKey<T>(name: string): ServiceKey<T> {
  return { name } as ServiceKey<T>;
}

function getServiceName<T>(identifier: ServiceIdentifier<T>): string {
  return typeof identifier === "string" ? identifier : identifier.name;
}


/** Returns the global symbol key used to persist shared services. */
function getServiceRegistryKey(): string {
  return "__tavo_service_registry__";
}

function warnSsrServiceRegistration(name: string): void {
  if (name === "tavo:i18n") {
    return;
  }
  if (typeof window !== "undefined" || warnedSsrServices.has(name)) {
    return;
  }
  warnedSsrServices.add(name);
  console.warn(
    `tavo service: "${name}" was registered during SSR. ` +
      "Services are process-wide on the server, so mutable request-specific data can leak between users. " +
      "Keep per-user data request-scoped instead."
  );
}

/** Gets or initializes the process-wide service registry map. */
function getServiceRegistry(): GlobalServiceRegistry {
  const target = globalThis as Record<string, unknown>;
  const key = getServiceRegistryKey();
  const existing = target[key];
  if (existing instanceof Map) {
    return existing as GlobalServiceRegistry;
  }

  const registry = new Map<string, unknown>();
  target[key] = registry;
  return registry;
}

/** Registers a named app/service dependency and returns the same instance. */
export function registerService<T>(
  identifier: ServiceIdentifier<T>,
  service: T,
  options: RegisterServiceOptions = {}
): T {
  const name = getServiceName(identifier);
  warnSsrServiceRegistration(name);
  const registry = getServiceRegistry();
  if (
    name !== "tavo:i18n" &&
    registry.has(name) &&
    !options.override &&
    !warnedDuplicateServices.has(name)
  ) {
    warnedDuplicateServices.add(name);
    console.warn(
      `tavo service: "${name}" was registered more than once. ` +
        "The latest service replaced the previous value. Pass { override: true } to registerService() when this is intentional."
    );
  }
  registry.set(name, service);
  return service;
}

/** Looks up a previously registered service by name. */
export function getService<T>(identifier: ServiceIdentifier<T>): T {
  const name = getServiceName(identifier);
  const registry = getServiceRegistry();
  if (!registry.has(name)) {
    throw new Error(`tavo service: "${name}" was not registered.`);
  }
  return registry.get(name) as T;
}

/** Looks up an optional service by name without throwing when it is missing. */
export function tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
  const registry = getServiceRegistry();
  return registry.get(getServiceName(identifier)) as T | undefined;
}

/** Returns true when a named service exists in the shared registry. */
export function hasService(identifier: ServiceIdentifier): boolean {
  return getServiceRegistry().has(getServiceName(identifier));
}

/** Lists all registered service names. */
export function listServices(): string[] {
  return Array.from(getServiceRegistry().keys());
}

/** Removes a service registration. Intended primarily for tests. */
export function unregisterService(identifier: ServiceIdentifier): boolean {
  const name = getServiceName(identifier);
  warnedDuplicateServices.delete(name);
  warnedSsrServices.delete(name);
  return getServiceRegistry().delete(name);
}

/** Clears the shared service registry. Intended primarily for tests. */
export function clearServices(): void {
  getServiceRegistry().clear();
  warnedDuplicateServices.clear();
  warnedSsrServices.clear();
}
