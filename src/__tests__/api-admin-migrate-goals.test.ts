import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";
import type { LegacyGoalRow } from "@/lib/dashboard/migrate-goals-plan";
import { blockIdForGoal } from "@/lib/dashboard/ids";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { planGoalMigration } from "@/lib/dashboard/migrate-goals-plan";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";

const CHALLENGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_CHALLENGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CRED_ID = "cred-owner-1";
const KEY_V1 = Buffer.alloc(32, 1).toString("base64");

const GOAL: LegacyGoalRow = {
  id: "33333333-3333-4333-8333-333333333333",
  area: "cpf",
  title: "OA 余额",
  target: "100k",
  metric: "SGD",
  progress: 0.55,
  due_at: "2027-01-01T00:00:00.000Z",
  agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "active",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const cookieStore = {
  value: null as string | null,
  get(name: string) {
    if (name === "xjg_migrate_goals_stepup" && this.value) {
      return { value: this.value };
    }
    return undefined;
  },
  set(name: string, value: string) {
    if (name === "xjg_migrate_goals_stepup") this.value = value;
  },
};

describe("POST /api/admin/migrate-goals", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/passkey-step-up");
    vi.doUnmock("@/lib/origin");
    vi.doUnmock("@/lib/auth-guard");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/dashboard/migrate-goals");
    vi.doUnmock("next/headers");
    cookieStore.value = null;
    resetRateLimits();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
    process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
    resetFieldKeyringCache();

    vi.doMock("next/headers", () => ({
      cookies: async () => cookieStore,
    }));
  });

  function mockGoalsClient(goals: LegacyGoalRow[], existingIds?: Set<string>) {
    const existing = new Set(existingIds ?? []);
    let rpcWrites = 0;
    let lockHeld: string | null = null;
    return {
      client: {
        from: (table: string) => {
          if (table === "goals") {
            return {
              select: (
                _cols: string,
                opts?: { count?: string; head?: boolean },
              ) => {
                if (opts?.head && opts?.count === "exact") {
                  return Promise.resolve({
                    count: goals.length,
                    error: null,
                  });
                }
                const result = {
                  data: goals.map((g) =>
                    _cols === "id" ? { id: g.id } : g,
                  ),
                  error: null,
                };
                const ordered = {
                  range: async (from: number, to: number) => ({
                    data: goals.slice(from, to + 1),
                    error: null,
                  }),
                  then: (
                    resolve: (v: typeof result) => void,
                    reject?: (e: unknown) => void,
                  ) => Promise.resolve(result).then(resolve, reject),
                };
                return {
                  order: () => ordered,
                };
              },
            };
          }
          if (table === "dashboard_blocks") {
            return {
              select: (cols: string) => ({
                in: async (_c: string, ids: string[]) => {
                  if (cols === "id") {
                    return {
                      data: ids
                        .filter((id) => existing.has(id))
                        .map((id) => ({ id })),
                      error: null,
                    };
                  }
                  return {
                    data: ids
                      .filter((id) => existing.has(id))
                      .map((id) => {
                        const goal = goals.find(
                          (g) => blockIdForGoal(g.id) === id,
                        );
                        const plan = goal
                          ? planGoalMigration(goal, new Set())
                          : null;
                        const payload =
                          plan && plan.action === "upsert"
                            ? encryptBlockPayload(id, plan.block.payload)
                            : "";
                        return { id, payload };
                      }),
                    error: null,
                  };
                },
              }),
            };
          }
          return {};
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          if (name === "try_acquire_migrate_goals_lock") {
            if (lockHeld) return { data: false, error: null };
            lockHeld = String(args.p_holder);
            return { data: true, error: null };
          }
          if (name === "release_migrate_goals_lock") {
            if (lockHeld === String(args.p_holder)) lockHeld = null;
            return { data: true, error: null };
          }
          rpcWrites += 1;
          const blockId = String(args.p_block_id);
          if (existing.has(blockId)) {
            return { data: { status: "already_migrated" }, error: null };
          }
          existing.add(blockId);
          return { data: { status: "inserted" }, error: null };
        },
      },
      getWrites: () => rpcWrites,
      isLocked: () => lockHeld !== null,
    };
  }

  it("returns 404 when unauthenticated (non-owner)", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
      }),
    }));
    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "plan",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding: "x",
        }),
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing / invalid step-up binding", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => mockGoalsClient([GOAL]).client,
    }));

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "plan",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding: "not-a-valid-jwt",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid binding");
  });

  it("rejects expired step-up binding", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => mockGoalsClient([GOAL]).client,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const past = new Date(Date.now() - 10 * 60 * 1000);
    const binding = await createAgentTokenStepUpBinding(
      {
        challengeId: CHALLENGE_ID,
        action: "migrate_goals_plan",
      },
      past,
    );

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "plan",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects when passkey challenge is invalid / expired", async () => {
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => mockGoalsClient([GOAL]).client,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_plan",
    });

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "plan",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid challenge");
  });

  it("dry-run plan returns counts, csrf, audits, and makes no RPC writes", async () => {
    const { client, getWrites } = mockGoalsClient([GOAL]);
    const auditSpy = vi.spyOn(console, "info").mockImplementation(() => {});
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => client,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_plan",
    });

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "plan",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      to_migrate: number;
      already_existing: number;
      csrf_token: string;
      plan_challenge_id: string;
    };
    expect(body.to_migrate).toBe(1);
    expect(body.already_existing).toBe(0);
    expect(body.csrf_token.length).toBeGreaterThan(10);
    expect(body.plan_challenge_id).toBe(CHALLENGE_ID);
    expect(getWrites()).toBe(0);
    expect(JSON.stringify(body)).not.toContain("OA 余额");
    expect(auditSpy).toHaveBeenCalled();
    const auditLine = String(auditSpy.mock.calls[0]?.[0]);
    expect(auditLine).toContain('"action":"plan"');
    expect(auditLine).toContain('"actor_type":"user"');
    expect(auditLine).not.toContain("OA 余额");
    auditSpy.mockRestore();

    // Capture step-up cookie from Set-Cookie if present
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const stepCookie = setCookie.find((c) =>
      c.startsWith("xjg_migrate_goals_stepup="),
    );
    if (stepCookie) {
      cookieStore.value = stepCookie.split("=")[1]?.split(";")[0] ?? null;
    }
  });

  it("execute rejects without confirm / csrf / recent step-up", async () => {
    const { client } = mockGoalsClient([GOAL]);
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => client,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const { POST } = await import("@/app/api/admin/migrate-goals/route");

    // Missing confirm / csrf fields → invalid body
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });
    const noConfirm = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "execute",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          csrf_token: "x",
          plan_challenge_id: PLAN_CHALLENGE_ID,
          confirm: false,
        }),
      }),
    );
    expect(noConfirm.status).toBe(400);

    // Valid shape but no recent step-up cookie → 404
    const { createMigrateGoalsCsrfToken } = await import(
      "@/lib/migrate-goals-csrf"
    );
    const csrf = await createMigrateGoalsCsrfToken({
      planChallengeId: PLAN_CHALLENGE_ID,
    });
    const binding2 = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });
    cookieStore.value = null;
    const noStepUp = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "execute",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding: binding2,
          csrf_token: csrf,
          plan_challenge_id: PLAN_CHALLENGE_ID,
          confirm: true,
        }),
      }),
    );
    expect(noStepUp.status).toBe(404);
    expect(noStepUp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("execute with confirm+csrf+step-up writes once then kill-switches", async () => {
    const { client, getWrites } = mockGoalsClient([GOAL]);
    const auditSpy = vi.spyOn(console, "info").mockImplementation(() => {});
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => client,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const { createMigrateGoalsCsrfToken } = await import(
      "@/lib/migrate-goals-csrf"
    );
    const { createMigrateGoalsStepUpToken } = await import(
      "@/lib/migrate-goals-stepup"
    );
    const { resetMigrateExecuteLockForTests } = await import(
      "@/lib/dashboard/migrate-goals"
    );
    resetMigrateExecuteLockForTests();

    cookieStore.value = await createMigrateGoalsStepUpToken({
      credentialId: CRED_ID,
      planChallengeId: PLAN_CHALLENGE_ID,
    });
    const csrf = await createMigrateGoalsCsrfToken({
      planChallengeId: PLAN_CHALLENGE_ID,
    });

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });
    const first = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "execute",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          csrf_token: csrf,
          plan_challenge_id: PLAN_CHALLENGE_ID,
          confirm: true,
        }),
      }),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const firstBody = (await first.json()) as {
      inserted: number;
      verify: {
        ok: boolean;
        decrypt_ok: number;
        decrypt_failed_ids: string[];
        missing_ids: string[];
        counts_match: boolean;
      };
    };
    expect(firstBody.inserted).toBe(1);
    expect(firstBody.verify.ok).toBe(true);
    expect(firstBody.verify.counts_match).toBe(true);
    expect(firstBody.verify.decrypt_ok).toBe(1);
    expect(firstBody.verify.decrypt_failed_ids).toEqual([]);
    expect(firstBody.verify.missing_ids).toEqual([]);
    expect(getWrites()).toBe(1);
    expect(JSON.stringify(firstBody)).not.toContain("OA 余额");

    const auditLines = auditSpy.mock.calls.map((c) => String(c[0]));
    expect(auditLines.some((l) => l.includes('"action":"execute"'))).toBe(
      true,
    );
    auditSpy.mockRestore();

    const binding2 = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });
    const csrf2 = await createMigrateGoalsCsrfToken({
      planChallengeId: PLAN_CHALLENGE_ID,
    });
    const second = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "execute",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding: binding2,
          csrf_token: csrf2,
          plan_challenge_id: PLAN_CHALLENGE_ID,
          confirm: true,
        }),
      }),
    );
    expect(second.status).toBe(404);
  });

  it("returns 409 when DB advisory lock is held", async () => {
    const { client } = mockGoalsClient([GOAL]);
    // Force lock acquire to fail
    const lockedClient = {
      ...client,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "try_acquire_migrate_goals_lock") {
          return { data: false, error: null };
        }
        return client.rpc(name, args);
      },
    };
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => lockedClient,
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const { createMigrateGoalsCsrfToken } = await import(
      "@/lib/migrate-goals-csrf"
    );
    const { createMigrateGoalsStepUpToken } = await import(
      "@/lib/migrate-goals-stepup"
    );
    const { resetMigrateExecuteLockForTests } = await import(
      "@/lib/dashboard/migrate-goals"
    );
    resetMigrateExecuteLockForTests();

    cookieStore.value = await createMigrateGoalsStepUpToken({
      credentialId: CRED_ID,
      planChallengeId: PLAN_CHALLENGE_ID,
    });
    const csrf = await createMigrateGoalsCsrfToken({
      planChallengeId: PLAN_CHALLENGE_ID,
    });
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/admin/migrate-goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          action: "execute",
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          csrf_token: csrf,
          plan_challenge_id: PLAN_CHALLENGE_ID,
          confirm: true,
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
