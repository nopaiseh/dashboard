import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const SECRET = "test-session-secret-at-least-32-chars!!";

describe("unauthenticated access", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterAll(() => {
    delete process.env.SESSION_SECRET;
  });

  it("proxy returns 401 for protected api without cookie", async () => {
    const { proxy } = await import("@/proxy");
    const request = new Request("http://localhost/api/items", {
      method: "GET",
    }) as unknown as import("next/server").NextRequest;

    // Minimal NextRequest-like shim
    const nextRequest = {
      nextUrl: new URL("http://localhost/api/items"),
      cookies: { get: () => undefined },
      url: "http://localhost/api/items",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;

    void request;
    const res = await proxy(nextRequest);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("proxy redirects pages to /login without cookie", async () => {
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

  it("proxy allows /login and agent api without session", async () => {
    const { proxy } = await import("@/proxy");
    const loginReq = {
      nextUrl: new URL("http://localhost/login"),
      cookies: { get: () => undefined },
      url: "http://localhost/login",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;
    const loginRes = await proxy(loginReq);
    expect(loginRes.status).toBe(200);

    const agentReq = {
      nextUrl: new URL("http://localhost/api/agent/items"),
      cookies: { get: () => undefined },
      url: "http://localhost/api/agent/items",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest;
    const agentRes = await proxy(agentReq);
    expect(agentRes.status).toBe(200);
  });

  it("proxy allows authenticated session cookie", async () => {
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
  });
});
