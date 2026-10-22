import { describe, expect, test } from "bun:test";
import { CookieJar } from "../src/cookie-jar.ts";

describe("CookieJar", () => {
  test("parses a simple cookie", () => {
    const jar = new CookieJar();
    jar.parse("access_token=abc123; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(jar.value("access_token")).toBe("abc123");
    expect(jar.header()).toBe("access_token=abc123");
  });

  test("respects Max-Age=0 by deleting", () => {
    const jar = new CookieJar();
    jar.parse("access_token=abc; Path=/");
    jar.parse("access_token=; Path=/; Max-Age=0");
    expect(jar.has("access_token")).toBe(false);
  });

  test("parses multiple Set-Cookie headers from a Response", () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/; HttpOnly");
    const jar = new CookieJar();
    jar.absorb(new Response(null, { headers }));
    expect(jar.value("a")).toBe("1");
    expect(jar.value("b")).toBe("2");
  });

  test("round-trips through JSON", () => {
    const jar = new CookieJar();
    jar.parse("x=hello%20world; Path=/");
    const restored = CookieJar.fromJSON(jar.toJSON());
    expect(restored.value("x")).toBe("hello%20world");
  });

  test("percent-encoded values are preserved", () => {
    const jar = new CookieJar();
    jar.parse("__Host-csrf=v-abc.123.xyz; Path=/; Secure");
    expect(jar.value("__Host-csrf")).toBe("v-abc.123.xyz");
  });
});
