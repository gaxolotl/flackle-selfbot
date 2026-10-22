import { CookieJar } from "./cookie-jar.ts";
import { FlackleAPIError, FlackleAuthError, FlackleError } from "./errors.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { jwtExpiry, sleep, toQueryString } from "./util.ts";

export const DEFAULT_BASE_URL = "https://flackle.com";
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send the `Authorization: Bearer` header. Defaults to true. */
  auth?: boolean;
  /** Send captured cookies. Defaults to true. */
  cookies?: boolean;
  /** Try a token refresh on 401. Defaults to true. */
  refreshOn401?: boolean;
  /** Retries for 429 / 5xx responses. Defaults to the client setting. */
  retries?: number;
  timeoutMs?: number;
}

export interface RestClientOptions {
  baseUrl?: string;
  userAgent?: string;
  requestIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export class RestClient {
  readonly baseUrl: string;
  readonly jar: CookieJar;
  readonly limiter: RateLimiter;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  accessToken?: string;
  refreshToken?: string;

  readonly #fetch: typeof fetch;
  #refreshPromise: Promise<boolean> | null = null;

  constructor(options: RestClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.jar = new CookieJar();
    this.limiter = new RateLimiter(options.requestIntervalMs ?? 50);
    this.#fetch = options.fetch ?? fetch;
  }

  get csrfToken(): string | undefined {
    return this.jar.value("__Host-csrf");
  }

  get hasSession(): boolean {
    return Boolean(
      this.accessToken ??
        this.jar.value("access_token") ??
        this.jar.value("refresh_token"),
    );
  }

  setTokens(tokens: { accessToken?: string; refreshToken?: string; csrfToken?: string }): void {
    if (tokens.accessToken) {
      this.accessToken = tokens.accessToken;
      this.jar.set({
        name: "access_token",
        value: tokens.accessToken,
        expires: jwtExpiry(tokens.accessToken) ?? undefined,
        path: "/",
        secure: true,
        httpOnly: true,
      });
    }
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      this.jar.set({
        name: "refresh_token",
        value: tokens.refreshToken,
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
        path: "/",
        secure: true,
        httpOnly: true,
      });
    }
    if (tokens.csrfToken) {
      this.jar.set({ name: "__Host-csrf", value: tokens.csrfToken, path: "/", secure: true });
    }
  }

  clearSession(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.jar.delete("access_token");
    this.jar.delete("refresh_token");
    this.jar.delete("__Host-csrf");
  }

  /**
   * Some endpoints return the CSRF cookie only on a 401. Fetch one early so the
   * first mutating request does not fail.
   */
  async ensureCsrf(force = false): Promise<string | undefined> {
    if (!force && this.csrfToken) return this.csrfToken;
    if (force) this.jar.delete("__Host-csrf");
    try {
      const res = await this.#fetch(`${this.baseUrl}/api/auth/me`, {
        headers: {
          accept: "*/*",
          "user-agent": this.userAgent,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      this.jar.absorb(res);
      await res.body?.cancel();
    } catch {
      // The 401 response is enough; if the network is down the real request
      // will surface a better error.
    }
    return this.csrfToken;
  }

  /** Refreshes the access token using the refresh-token cookie. */
  async refresh(): Promise<boolean> {
    if (this.#refreshPromise) return this.#refreshPromise;

    this.#refreshPromise = (async () => {
      const refreshToken = this.jar.value("refresh_token") ?? this.refreshToken;
      if (!refreshToken) throw new FlackleAuthError("No refresh token available");

      const res = await this.request<{ ok?: boolean; access_token?: string }>("POST", "/api/auth/refresh", {
        auth: false,
        cookies: true,
        refreshOn401: false,
        retries: 0,
        headers: {
          Cookie: this.#cookieWith("refresh_token", refreshToken),
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      const token = res?.access_token ?? this.jar.value("access_token");
      if (!token) throw new FlackleAuthError("Refresh succeeded but no access token was returned");
      this.accessToken = token;
      this.refreshToken = this.jar.value("refresh_token") ?? refreshToken;
      return true;
    })()
      .catch((error) => {
        if (error instanceof FlackleAPIError && (error.status === 401 || error.status === 403)) {
          this.clearSession();
          throw new FlackleAuthError("Session expired; please log in again");
        }
        throw error;
      })
      .finally(() => {
        this.#refreshPromise = null;
      });

    return this.#refreshPromise;
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async put<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  async patch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  async delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  async request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}${toQueryString(options.query)}`;
    const retries = options.retries ?? this.maxRetries;

    if (method !== "GET" && options.cookies !== false) await this.ensureCsrf();

    let refreshed = false;
    let csrfRetried = false;
    let attempt = 0;

    for (;;) {
      const response = await this.#send(method, url, options);
      this.jar.absorb(response);

      if (response.status === 401 && options.refreshOn401 !== false && !refreshed && this.#canRefresh(options)) {
        refreshed = true;
        await this.#discard(response);
        try {
          await this.refresh();
          continue;
        } catch (error) {
          throw error instanceof FlackleError ? error : new FlackleAuthError(String(error));
        }
      }

      if (response.status === 403 && !csrfRetried) {
        const body = await this.#readBody(response);
        if (isRecord(body) && body.code === "csrf_invalid") {
          csrfRetried = true;
          await this.ensureCsrf(true);
          continue;
        }
        throw this.#toError(method, path, response, body);
      }

      if (response.status === 429 && attempt < retries) {
        attempt++;
        const retryAfter = parseRetryAfter(response.headers.get("retry-after")) ?? Math.min(1000 * 2 ** attempt, 15_000);
        this.limiter.blockFor(retryAfter);
        await this.#discard(response);
        await sleep(retryAfter);
        continue;
      }

      if (response.status >= 500 && attempt < retries) {
        attempt++;
        const retryAfter = parseRetryAfter(response.headers.get("retry-after")) ?? Math.min(500 * 2 ** attempt, 10_000);
        await this.#discard(response);
        await sleep(retryAfter);
        continue;
      }

      if (!response.ok) {
        const body = await this.#readBody(response);
        throw this.#toError(method, path, response, body);
      }

      return (await this.#readBody(response)) as T;
    }
  }

  /** PUT a raw body to an absolute (usually presigned) URL, returning the ETag. */
  async putAbsolute(url: string, body: BodyInit, timeoutMs = 5 * 60_000): Promise<string> {
    const res = await this.#fetch(url, {
      method: "PUT",
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const etag = res.headers.get("etag");
    if (!res.ok || !etag) {
      await this.#discard(res);
      throw new FlackleError(`Upload part failed with ${res.status}${etag ? "" : " (missing ETag)"}`);
    }
    await res.body?.cancel();
    return etag;
  }

  async #send(method: HttpMethod, url: string, options: RequestOptions): Promise<Response> {
    return this.limiter.schedule(async () => {
      const headers = this.#headers(method, options);
      const body = serializeBody(options.body, headers);
      try {
        return await this.#fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
          redirect: "follow",
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new FlackleError(`Request timed out: ${method} ${url}`);
        }
        throw new FlackleError(`Network error on ${method} ${url}: ${String(error)}`);
      }
    });
  }

  #headers(method: HttpMethod, options: RequestOptions): Headers {
    const headers = new Headers(options.headers);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("accept-language")) headers.set("accept-language", "en-GB,en;q=0.9");
    if (!headers.has("user-agent")) headers.set("user-agent", this.userAgent);
    if (!headers.has("x-requested-with")) headers.set("x-requested-with", "XMLHttpRequest");

    if (method !== "GET" && !headers.has("origin")) headers.set("origin", this.baseUrl);
    if (!headers.has("referer")) headers.set("referer", `${this.baseUrl}/app`);

    if (options.cookies !== false && !headers.has("cookie")) {
      const cookie = this.jar.header();
      if (cookie) headers.set("cookie", cookie);
    }

    if (options.auth !== false && this.accessToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.accessToken}`);
    }

    const csrf = this.csrfToken;
    if (csrf && !headers.has("x-csrf-token")) headers.set("x-csrf-token", csrf);

    return headers;
  }

  #canRefresh(options: RequestOptions): boolean {
    if (options.auth === false && options.cookies === false) return false;
    return Boolean(this.jar.value("refresh_token") ?? this.refreshToken);
  }

  #cookieWith(name: string, value: string): string {
    const rest = this.jar
      .toJSON()
      .filter((cookie) => cookie.name !== name)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    rest.push(`${name}=${value}`);
    return rest.join("; ");
  }

  async #readBody(response: Response): Promise<unknown> {
    if (response.status === 204 || response.status === 205) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const text = await response.text();
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    const text = await response.text();
    return text || undefined;
  }

  #toError(method: HttpMethod, path: string, response: Response, body: unknown): FlackleAPIError {
    const record = isRecord(body) ? body : undefined;
    const message =
      (typeof record?.error === "string" && record.error) ||
      (typeof record?.message === "string" && record.message) ||
      `${response.status} ${response.statusText}`;
    return new FlackleAPIError({
      status: response.status,
      method,
      path,
      code: typeof record?.code === "string" ? record.code : undefined,
      message,
      body,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  async #discard(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function serializeBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit;
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}
