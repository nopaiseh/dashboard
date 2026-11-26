import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCspHeader, generateCspNonce } from "@/lib/security-headers";

const SECRET = "test-session-secret-at-least-32-chars!!";

describe("CSP nonce", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterAll(() => {
    delete process.env.SESSION_SECRET;
  });

  it("buildCspHeader includes nonce and omits unsafe-inline/eval in production", () => {
    const nonce = generateCspNonce();
    const csp = buildCspHeader(nonce, { isDev: false });
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("proxy responses include distinct nonces per request", async () => {
    const { proxy } = await import("@/proxy");
    const makeReq = () =>
      ({
        nextUrl: new URL("http://localhost/login"),
        cookies: { get: () => undefined },
        url: "http://localhost/login",
        headers: new Headers(),
      }) as unknown as import("next/server").NextRequest;

    const a = await proxy(makeReq());
    const b = await proxy(makeReq());
    const cspA = a.headers.get("content-security-policy") ?? "";
    const cspB = b.headers.get("content-security-policy") ?? "";
    const nonceA = /'nonce-([^']+)'/.exec(cspA)?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(cspB)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
    expect(cspA).toContain("'strict-dynamic'");
  });
});
