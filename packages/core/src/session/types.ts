export type SessionCookieSameSite = "lax" | "strict" | "none";

export type SessionCookieOptions = {
  domain?: string;
  httpOnly?: boolean;
  maxAge?: number;
  name: string;
  path?: string;
  sameSite?: SessionCookieSameSite;
  secrets: string[];
  secure?: boolean;
};

export type SessionStoreEntry<T extends Record<string, unknown>> = {
  data: T;
  expiresAt: number | null;
};

export type SessionStore<T extends Record<string, unknown>> = {
  get(id: string): Promise<SessionStoreEntry<T> | null> | SessionStoreEntry<T> | null;
  set(id: string, entry: SessionStoreEntry<T>): Promise<void> | void;
  delete(id: string): Promise<void> | void;
};

export type SessionCommitOptions = {
  maxAge?: number;
};

export type SessionStorageOptions<T extends Record<string, unknown>> = {
  cookie: SessionCookieOptions;
  store?: SessionStore<T>;
};

export type Session<T extends Record<string, unknown>> = {
  readonly data: T;
  readonly id: string;
  readonly isNew: boolean;
  readonly rotated: boolean;
  readonly secure: boolean;
  delete(key: keyof T & string): void;
  destroy(): void;
  get<K extends keyof T & string>(key: K): T[K] | undefined;
  has(key: keyof T & string): boolean;
  rotate(): void;
  set<K extends keyof T & string>(key: K, value: T[K]): void;
};

export type SessionStorage<T extends Record<string, unknown>> = {
  commitSession(session: Session<T>, options?: SessionCommitOptions): Promise<string>;
  destroySession(session: Session<T>, options?: SessionCommitOptions): Promise<string>;
  getSession(contextOrRequest?: unknown): Promise<Session<T>>;
  redirect(to: string, session: Session<T>, init?: ResponseInit): Promise<Response>;
};
