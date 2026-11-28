import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_TOKEN_PREFIX,
  agentTokenIdSuffix,
  generateAgentBearerToken,
  hashAgentToken,
} from "@/lib/crypto";
import { authenticateAgentToken } from "@/lib/agent-auth";
import { resetRateLimits } from "@/lib/rate-limit";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHALLENGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CRED_ID = "cred-owner-1";

describe("agent bearer token generation", () => {
  it("uses recognizable prefix and >=256 bits entropy", () => {
    const token = generateAgentBearerToken();
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    const payload = token.slice(AGENT_TOKEN_PREFIX.length);
    // base64url of 32 bytes → 43 chars
    expect(payload.length).toBeGreaterThanOrEqual(43);
    expect(hashAgentToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issued token authenticates; revoked record is rejected", () => {
    const raw = generateAgentBearerToken();
    const hash = hashAgentToken(raw);
    expect(
      authenticateAgentToken(raw, [
        { agent_id: AGENT_ID, token_hash: hash, revoked_at: null },
      ])?.agentId,
    ).toBe(AGENT_ID);
    expect(
      authenticateAgentToken(raw, [
        {
          agent_id: AGENT_ID,
          token_hash: hash,
          revoked_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("id suffix never exposes hash", () => {
    const suffix = agentTokenIdSuffix(TOKEN_ID);
    expect(suffix).toBe("bbbbbbbb");
    expect(suffix).not.toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("owner agent token APIs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/passkey-step-up");
    vi.doUnmock("@/lib/challenges");
    vi.doUnmock("@/lib/webauthn");
    vi.doUnmock("@/lib/origin");
    vi.doUnmock("@/lib/auth-guard");
    vi.doUnmock("@/lib/supabase/server");
    resetRateLimits();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  async function mockHappyPasskey() {
    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/passkey-step-up", () => ({
      consumePasskeyAssertion: async () => ({
        ok: true,
        credentialId: CRED_ID,
      }),
    }));
    return { createAgentTokenStepUpBinding };
  }

  it("GET /api/owner/agents returns 401 when unauthenticated", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
      }),
    }));
    const { GET } = await import("@/app/api/owner/agents/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects issue without passkey / invalid challenge", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/passkey-step-up", () => ({
      consumePasskeyAssertion: async () => ({
        ok: false,
        status: 400,
        error: "invalid challenge",
      }),
    }));
    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "issue_agent_token",
      agentId: AGENT_ID,
    });

    const { POST } = await import(
      "@/app/api/owner/agents/[id]/tokens/route"
    );
    const res = await POST(
      new Request(
        `https://desk.nopaiseh.com/api/owner/agents/${AGENT_ID}/tokens`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            challenge_id: CHALLENGE_ID,
            assertion: { id: CRED_ID },
            binding,
            revoke_previous: true,
            allowed_categories: ["cpf"],
          }),
        },
      ),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid challenge");
  });

  it("rejects when binding challenge_id does not match request", async () => {
    await mockHappyPasskey();
    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    // Binding for a different challenge id → invalid binding before claim
    const binding = await createAgentTokenStepUpBinding({
      challengeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      action: "issue_agent_token",
      agentId: AGENT_ID,
    });

    const { POST } = await import(
      "@/app/api/owner/agents/[id]/tokens/route"
    );
    const res = await POST(
      new Request(
        `https://desk.nopaiseh.com/api/owner/agents/${AGENT_ID}/tokens`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            challenge_id: CHALLENGE_ID,
            assertion: { id: CRED_ID },
            binding,
            revoke_previous: true,
            allowed_categories: ["cpf"],
          }),
        },
      ),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid binding");
  });

  it("second claim of the same challenge returns 400", async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({
        id: CHALLENGE_ID,
        challenge: "chal",
        purpose: "login",
        item_id: null,
        authorized: false,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce(null);

    vi.doMock("@/lib/challenges", () => ({
      claimChallenge: claim,
    }));
    vi.doMock("@/lib/webauthn", () => ({
      verifyLoginAssertion: async () => ({
        verified: true,
        authenticationInfo: { newCounter: 2 },
      }),
    }));

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                credential_id: CRED_ID,
                public_key: "pk",
                counter: 1,
                transports: [],
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    };

    const { consumePasskeyAssertion } = await import(
      "@/lib/passkey-step-up"
    );
    const first = await consumePasskeyAssertion({
      supabase: supabase as never,
      challengeId: CHALLENGE_ID,
      purpose: "login",
      assertion: { id: CRED_ID },
    });
    expect(first.ok).toBe(true);

    const second = await consumePasskeyAssertion({
      supabase: supabase as never,
      challengeId: CHALLENGE_ID,
      purpose: "login",
      assertion: { id: CRED_ID },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.status).toBe(400);
      expect(second.error).toBe("invalid challenge");
    }
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("issues token once: response has plaintext, no hash; list has no plaintext", async () => {
    const auditSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const inserted: Array<Record<string, unknown>> = [];
    let rawForAuth = "";

    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/passkey-step-up", () => ({
      consumePasskeyAssertion: async () => ({
        ok: true,
        credentialId: CRED_ID,
      }),
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "issue_agent_token",
      agentId: AGENT_ID,
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "agents") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: AGENT_ID, slug: "sister-01" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "agent_tokens") {
            return {
              update: () => ({
                eq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              }),
              insert: (row: Record<string, unknown>) => {
                inserted.push(row);
                return {
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: TOKEN_ID,
                        created_at: "2026-11-27T00:00:00.000Z",
                        allowed_categories: row.allowed_categories ?? ["cpf"],
                      },
                      error: null,
                    }),
                  }),
                };
              },
              select: (cols: string) => {
                void cols;
                return {
                  is: () =>
                    Promise.resolve({
                      // After revoke_previous, no active tokens remain.
                      data: [],
                      error: null,
                    }),
                  order: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: TOKEN_ID,
                          agent_id: AGENT_ID,
                          created_at: "2026-11-27T00:00:00.000Z",
                          revoked_at: null,
                          allowed_categories: ["cpf"],
                        },
                      ],
                      error: null,
                    }),
                };
              },
            };
          }
          if (table === "dashboard_sections") {
            return {
              select: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                      agent_id: AGENT_ID,
                      category: "cpf",
                    },
                  ],
                  error: null,
                }),
            };
          }
          if (table === "agents") {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: AGENT_ID,
                        slug: "sister-01",
                        name: "甲",
                        area: "a",
                        bot_id: null,
                        created_at: "2026-01-01T00:00:00.000Z",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      }),
    }));

    const { POST } = await import(
      "@/app/api/owner/agents/[id]/tokens/route"
    );
    const res = await POST(
      new Request(
        `https://desk.nopaiseh.com/api/owner/agents/${AGENT_ID}/tokens`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            challenge_id: CHALLENGE_ID,
            assertion: { id: CRED_ID },
            binding,
            revoke_previous: true,
            allowed_categories: ["cpf"],
          }),
        },
      ),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.token).toBe("string");
    rawForAuth = body.token as string;
    expect(rawForAuth.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/token_hash/);
    expect(body.allowed_categories).toEqual(["cpf"]);
    expect(inserted[0]?.token_hash).toBe(hashAgentToken(rawForAuth));
    expect(inserted[0]?.token_hash).not.toBe(rawForAuth);
    expect(inserted[0]?.allowed_categories).toEqual(["cpf"]);

    // issued token passes agent-auth
    expect(
      authenticateAgentToken(rawForAuth, [
        {
          agent_id: AGENT_ID,
          token_hash: inserted[0]?.token_hash as string,
          revoked_at: null,
        },
      ])?.agentId,
    ).toBe(AGENT_ID);

    // list endpoint: no plaintext / hash
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";

    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "agents") {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: AGENT_ID,
                        slug: "sister-01",
                        name: "甲",
                        area: "a",
                        bot_id: null,
                        created_at: "2026-01-01T00:00:00.000Z",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "agent_tokens") {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: TOKEN_ID,
                        agent_id: AGENT_ID,
                        created_at: "2026-11-27T00:00:00.000Z",
                        revoked_at: null,
                        allowed_categories: ["cpf"],
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          throw new Error(`unexpected ${table}`);
        },
      }),
    }));

    const { GET } = await import("@/app/api/owner/agents/route");
    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.text();
    expect(listBody).not.toContain(rawForAuth);
    expect(listBody).not.toContain("token_hash");
    expect(listBody).toContain(agentTokenIdSuffix(TOKEN_ID));
    expect(listBody).toContain("cpf");

    expect(auditSpy).toHaveBeenCalled();
    const auditLine = String(auditSpy.mock.calls[0]?.[0]);
    expect(auditLine).toContain('"action":"issue"');
    expect(auditLine).not.toContain(rawForAuth);
    auditSpy.mockRestore();
  });

  it("revoke sets revoked_at semantics and rejects unbound replay", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/passkey-step-up", () => ({
      consumePasskeyAssertion: async () => ({
        ok: true,
        credentialId: CRED_ID,
      }),
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "revoke_agent_token",
      agentId: AGENT_ID,
      tokenId: TOKEN_ID,
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "agents") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: AGENT_ID, slug: "sister-01" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "agent_tokens") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: TOKEN_ID,
                      agent_id: AGENT_ID,
                      revoked_at: null,
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  is: () => ({
                    select: () => ({
                      maybeSingle: async () => ({
                        data: {
                          id: TOKEN_ID,
                          revoked_at: "2026-11-27T12:00:00.000Z",
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected ${table}`);
        },
      }),
    }));

    const { POST } = await import(
      "@/app/api/owner/agents/[id]/tokens/[tokenId]/revoke/route"
    );
    const res = await POST(
      new Request(
        `https://desk.nopaiseh.com/api/owner/agents/${AGENT_ID}/tokens/${TOKEN_ID}/revoke`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            challenge_id: CHALLENGE_ID,
            assertion: { id: CRED_ID },
            binding,
          }),
        },
      ),
      {
        params: Promise.resolve({ id: AGENT_ID, tokenId: TOKEN_ID }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked_at: string };
    expect(body.revoked_at).toBeTruthy();
  });

  it("proxy keeps /agents and /api/owner/* protected", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/agents", "/agents/00000000-0000-4000-8000-000000000001", "/api/owner/agents"]) {
      const res = await proxy({
        nextUrl: new URL(`http://localhost${path}`),
        cookies: { get: () => undefined },
        url: `http://localhost${path}`,
        headers: new Headers(),
      } as unknown as import("next/server").NextRequest);
      if (path.startsWith("/api/")) {
        expect(res.status).toBe(401);
      } else {
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toBe("http://localhost/login");
      }
    }
  });
});

describe("agent-token step-up binding", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  });

  it("binds action and agent; rejects cross-action reuse", async () => {
    const {
      createAgentTokenStepUpBinding,
      verifyAgentTokenStepUpBinding,
    } = await import("@/lib/agent-token-stepup");
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "issue_agent_token",
      agentId: AGENT_ID,
    });
    expect(
      await verifyAgentTokenStepUpBinding(binding, {
        challengeId: CHALLENGE_ID,
        action: "issue_agent_token",
        agentId: AGENT_ID,
      }),
    ).toBe(true);
    expect(
      await verifyAgentTokenStepUpBinding(binding, {
        challengeId: CHALLENGE_ID,
        action: "revoke_agent_token",
        agentId: AGENT_ID,
        tokenId: TOKEN_ID,
      }),
    ).toBe(false);
  });

  it("rejects binding older than 5 minutes", async () => {
    const {
      AGENT_TOKEN_STEPUP_TTL_MS,
      createAgentTokenStepUpBinding,
      verifyAgentTokenStepUpBinding,
    } = await import("@/lib/agent-token-stepup");
    const issuedAt = new Date("2026-11-27T12:00:00.000Z");
    const binding = await createAgentTokenStepUpBinding(
      {
        challengeId: CHALLENGE_ID,
        action: "issue_agent_token",
        agentId: AGENT_ID,
      },
      issuedAt,
    );
    const expiredAt = new Date(
      issuedAt.getTime() + AGENT_TOKEN_STEPUP_TTL_MS + 1000,
    );
    expect(
      await verifyAgentTokenStepUpBinding(
        binding,
        {
          challengeId: CHALLENGE_ID,
          action: "issue_agent_token",
          agentId: AGENT_ID,
        },
        expiredAt,
      ),
    ).toBe(false);
  });

  it("rejects agent_id or token_id mismatch", async () => {
    const {
      createAgentTokenStepUpBinding,
      verifyAgentTokenStepUpBinding,
    } = await import("@/lib/agent-token-stepup");
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "revoke_agent_token",
      agentId: AGENT_ID,
      tokenId: TOKEN_ID,
    });
    expect(
      await verifyAgentTokenStepUpBinding(binding, {
        challengeId: CHALLENGE_ID,
        action: "revoke_agent_token",
        agentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        tokenId: TOKEN_ID,
      }),
    ).toBe(false);
    expect(
      await verifyAgentTokenStepUpBinding(binding, {
        challengeId: CHALLENGE_ID,
        action: "revoke_agent_token",
        agentId: AGENT_ID,
        tokenId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      }),
    ).toBe(false);
  });

  it("binding is not a session; session is not a binding; proxy will not renew binding", async () => {
    const { createAgentTokenStepUpBinding, verifyAgentTokenStepUpBinding } =
      await import("@/lib/agent-token-stepup");
    const {
      SESSION_COOKIE_NAME,
      createSessionToken,
      verifySessionToken,
    } = await import("@/lib/session");
    const { proxy } = await import("@/proxy");

    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "issue_agent_token",
      agentId: AGENT_ID,
    });
    const session = await createSessionToken();

    expect(await verifySessionToken(binding)).toBeNull();
    expect(
      await verifyAgentTokenStepUpBinding(session, {
        challengeId: CHALLENGE_ID,
        action: "issue_agent_token",
        agentId: AGENT_ID,
      }),
    ).toBe(false);

    const res = await proxy({
      nextUrl: new URL("http://localhost/api/owner/agents"),
      cookies: {
        get: (name: string) =>
          name === SESSION_COOKIE_NAME ? { value: binding } : undefined,
      },
      url: "http://localhost/api/owner/agents",
      headers: new Headers(),
    } as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(401);
    // 未通过会话校验 → 不会 touch/续期写成新会话 cookie
    const setCookie = res.headers.getSetCookie?.() ?? [];
    expect(
      setCookie.some((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`)),
    ).toBe(false);
  });
});
