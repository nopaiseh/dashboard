import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_MAX,
  SESSION_COOKIE_NAME,
  createSessionToken,
} from "@/lib/session";

const SECRET = "test-session-secret-at-least-32-chars!!";

describe("unauthenticated access / proxy hardening", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterAll(() => {
    delete process.env.SESSION_SECRET;
  });

  it("returns 401 for protected api without cookie", async () => {
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/api/items"),
      cookies: { get: () => undefined },
      url: "http://localhost/api/items",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    const res = await proxy(nextRequest);
    expect(res.status).toBe(401);
  });

  it("redirects pages to /login without cookie", async () => {
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/"),
      cookies: { get: () => undefined },
      url: "http://localhost/",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    const res = await proxy(nextRequest);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("rejects when SESSION_SECRET is missing or too short", async () => {
    const token = await createSessionToken();
    delete process.env.SESSION_SECRET;
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/api/goals"),
      cookies: {
        get: (name: string) =>
          name === SESSION_COOKIE_NAME ? { value: token } : undefined,
      },
      url: "http://localhost/api/goals",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    expect((await proxy(nextRequest)).status).toBe(401);

    process.env.SESSION_SECRET = "too-short";
    expect((await proxy(nextRequest)).status).toBe(401);
    process.env.SESSION_SECRET = SECRET;
  });

  it("does not allow arbitrary extension paths", async () => {
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/secret.json"),
      cookies: { get: () => undefined },
      url: "http://localhost/secret.json",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    const res = await proxy(nextRequest);
    expect(res.status).toBe(307);
  });

  it("allows whitelisted public static assets", async () => {
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/next.svg"),
      cookies: { get: () => undefined },
      url: "http://localhost/next.svg",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    const res = await proxy(nextRequest);
    expect(res.status).toBe(200);
  });

  it("allows /login and agent api without session", async () => {
    const { proxy } = await import("@/proxy");
    const loginReq = {
      nextUrl: new URL("http://localhost/login"),
      cookies: { get: () => undefined },
      url: "http://localhost/login",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;
    expect((await proxy(loginReq)).status).toBe(200);

    const agentReq = {
      nextUrl: new URL("http://localhost/api/agent/items"),
      cookies: { get: () => undefined },
      url: "http://localhost/api/agent/items",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;
    expect((await proxy(agentReq)).status).toBe(200);
  });

  it("allows authenticated session cookie and sets security headers", async () => {
    const token = await createSessionToken();
    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/api/goals"),
      cookies: {
        get: (name: string) =>
          name === SESSION_COOKIE_NAME ? { value: token } : undefined,
      },
      url: "http://localhost/api/goals",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    const res = await proxy(nextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    // 续期 cookie 由 proxy 写出
    const setCookie = res.headers.getSetCookie?.() ?? [];
    expect(
      setCookie.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ||
        Boolean(res.headers.get("set-cookie")?.includes(SESSION_COOKIE_NAME)),
    ).toBe(true);
  });

  it("rejects session past absolute max (7d)", async () => {
    const issuedAt = new Date("2020-01-01T00:00:00.000Z");
    // 滑动续期后 lastActivity/exp 仍新，但 iat 已超绝对上限
    const token = await createSessionToken(
      new Date(),
      Math.floor(issuedAt.getTime() / 1000),
    );
    expect(Date.now()).toBeGreaterThan(
      issuedAt.getTime() + SESSION_ABSOLUTE_MAX,
    );

    const { proxy } = await import("@/proxy");
    const nextRequest = {
      nextUrl: new URL("http://localhost/api/goals"),
      cookies: {
        get: (name: string) =>
          name === SESSION_COOKIE_NAME ? { value: token } : undefined,
      },
      url: "http://localhost/api/goals",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    expect((await proxy(nextRequest)).status).toBe(401);
  });
});
