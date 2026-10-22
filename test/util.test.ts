import { describe, expect, test } from "bun:test";
import {
  dateToSnowflake,
  isJwtExpired,
  isSnowflake,
  jwtExpiry,
  randomNonce,
  snowflakeToDate,
  splitSetCookie,
  toQueryString,
} from "../src/util.ts";

describe("snowflakes", () => {
  test("validates snowflake strings", () => {
    expect(isSnowflake("369859355329171456")).toBe(true);
    expect(isSnowflake("abc")).toBe(false);
    expect(isSnowflake(123 as unknown)).toBe(false);
  });

  test("converts to a date and back", () => {
    const date = new Date("2026-10-22T07:00:00.000Z");
    const snowflake = dateToSnowflake(date);
    expect(Math.abs(snowflakeToDate(snowflake).getTime() - date.getTime())).toBeLessThan(2);
  });
});

describe("jwt helpers", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000, sub: "1" })).toString("base64url");
  const token = `header.${payload}.signature`;

  test("reads expiry", () => {
    expect(jwtExpiry(token)).toBe(1_800_000_000_000);
  });

  test("detects expired and malformed tokens", () => {
    const expired = `h.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.s`;
    expect(isJwtExpired(expired)).toBe(true);
    expect(isJwtExpired(undefined)).toBe(true);
    expect(isJwtExpired("not-a-jwt")).toBe(false);
  });
});

describe("misc", () => {
  test("builds a query string and skips empty values", () => {
    expect(toQueryString({ limit: 50, before: undefined, after: "1" })).toBe("?limit=50&after=1");
    expect(toQueryString({})).toBe("");
  });

  test("repeats array values as separate query parameters", () => {
    expect(toQueryString({ action_type: ["a", "b"], limit: 50 })).toBe(
      "?action_type=a&action_type=b&limit=50",
    );
  });

  test("splits combined set-cookie headers without breaking Expires", () => {
    const header = "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/";
    expect(splitSetCookie(header)).toEqual([
      "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
      "b=2; Path=/",
    ]);
  });

  test("nonces are unique", () => {
    expect(randomNonce()).not.toBe(randomNonce());
  });
});
