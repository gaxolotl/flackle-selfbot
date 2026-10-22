import { splitSetCookie } from "./util.ts";

export interface Cookie {
  name: string;
  value: string;
  /** Epoch ms, or undefined for a session cookie. */
  expires?: number;
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

/**
 * A tiny cookie jar. Flackle authenticates with HttpOnly cookies, so a plain
 * `fetch` wrapper is not enough: we have to capture `set-cookie` ourselves and
 * replay the header.
 */
export class CookieJar {
  readonly #cookies = new Map<string, Cookie>();

  get size(): number {
    return this.#cookies.size;
  }

  set(cookie: Cookie): void {
    if (cookie.maxAge !== undefined && cookie.maxAge <= 0) {
      this.#cookies.delete(cookie.name);
      return;
    }
    if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
      this.#cookies.delete(cookie.name);
      return;
    }
    this.#cookies.set(cookie.name, cookie);
  }

  get(name: string): Cookie | undefined {
    const cookie = this.#cookies.get(name);
    if (!cookie) return undefined;
    if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
      this.#cookies.delete(name);
      return undefined;
    }
    return cookie;
  }

  value(name: string): string | undefined {
    return this.get(name)?.value;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  delete(name: string): void {
    this.#cookies.delete(name);
  }

  clear(): void {
    this.#cookies.clear();
  }

  /** Serialises the jar into a `Cookie:` header value. */
  header(): string {
    const parts: string[] = [];
    for (const [name, cookie] of this.#cookies) {
      if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
        this.#cookies.delete(name);
        continue;
      }
      parts.push(`${name}=${cookie.value}`);
    }
    return parts.join("; ");
  }

  /** Reads every `set-cookie` header from a response into the jar. */
  absorb(response: Response): void {
    const withGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = withGetSetCookie.getSetCookie?.() ?? [];
    if (values.length === 0) {
      const combined = response.headers.get("set-cookie");
      if (combined) values.push(...splitSetCookie(combined));
    }
    for (const value of values) this.parse(value);
  }

  parse(header: string): Cookie | undefined {
    const segments = header.split(";").map((s) => s.trim());
    const first = segments.shift();
    if (!first) return undefined;
    const eq = first.indexOf("=");
    if (eq <= 0) return undefined;

    const cookie: Cookie = {
      name: first.slice(0, eq).trim(),
      value: first.slice(eq + 1).trim(),
    };

    for (const segment of segments) {
      const [rawKey, ...rest] = segment.split("=");
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join("=").trim();
      switch (key) {
        case "expires": {
          const date = Date.parse(value);
          if (!Number.isNaN(date)) cookie.expires = date;
          break;
        }
        case "max-age": {
          const seconds = Number(value);
          if (Number.isFinite(seconds)) {
            cookie.maxAge = seconds;
            if (cookie.expires === undefined) cookie.expires = Date.now() + seconds * 1000;
          }
          break;
        }
        case "path":
          cookie.path = value;
          break;
        case "domain":
          cookie.domain = value;
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "samesite":
          cookie.sameSite = value;
          break;
      }
    }

    this.set(cookie);
    return cookie;
  }

  toJSON(): Cookie[] {
    return [...this.#cookies.values()];
  }

  load(cookies: Cookie[]): void {
    for (const cookie of cookies) this.set(cookie);
  }

  static fromJSON(cookies: Cookie[]): CookieJar {
    const jar = new CookieJar();
    jar.load(cookies);
    return jar;
  }
}
