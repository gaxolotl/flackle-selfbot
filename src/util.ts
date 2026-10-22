/** Epoch used by Discord-style snowflakes. */
export const DISCORD_EPOCH = 1_420_070_400_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns a fresh nonce used to correlate optimistic messages with gateway echoes. */
export function randomNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,25}$/.test(value);
}

/** Extracts the creation time of a Discord-style snowflake. */
export function snowflakeToDate(snowflake: string): Date {
  return new Date(Number(BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
}

export function dateToSnowflake(date: Date): string {
  return ((BigInt(date.getTime() - DISCORD_EPOCH) << 22n) | 0n).toString();
}

/** Decodes the `exp` claim of a JWT without verifying it. Returns epoch ms. */
export function jwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the JWT is missing, malformed or within `leewayMs` of expiring. */
export function isJwtExpired(token: string | undefined, leewayMs = 30_000): boolean {
  if (!token) return true;
  const exp = jwtExpiry(token);
  if (exp === null) return false;
  return Date.now() + leewayMs >= exp;
}

/**
 * Splits a combined `set-cookie` header. `Headers.getSetCookie()` is preferred,
 * but Node's fallback returns one comma-joined string and `Expires` contains a
 * comma, so this only splits before a token that starts a new cookie.
 */
export function splitSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=)/g).map((part) => part.trim());
}

export function toQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/** Redacts a secret for logging. */
export function redact(value: string | undefined, keep = 6): string {
  if (!value) return "<none>";
  if (value.length <= keep * 2) return "***";
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
