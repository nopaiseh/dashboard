import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";
import type { LegacyGoalRow } from "@/lib/dashboard/migrate-goals-plan";
import { blockIdForGoal } from "@/lib/dashboard/ids";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { planGoalMigration } from "@/lib/dashboard/migrate-goals-plan";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";

const CHALLENGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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

describe("POST /api/admin/migrate-goals", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/passkey-step-up");
    vi.doUnmock("@/lib/origin");
    vi.doUnmock("@/lib/auth-guard");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/dashboard/migrate-goals");
    resetRateLimits();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
    process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
    resetFieldKeyringCache();
  });

  function mockGoalsClient(goals: LegacyGoalRow[], existingIds?: Set<string>) {
    const existing = new Set(existingIds ?? []);
    let rpcWrites = 0;
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
        rpc: async (_name: string, args: Record<string, unknown>) => {
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

  it("dry-run plan returns counts and makes no RPC writes", async () => {
    const { client, getWrites } = mockGoalsClient([GOAL]);
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
      scanned: number;
      would_upsert: number;
      skipped_migrated: number;
    };
    expect(body.scanned).toBe(1);
    expect(body.would_upsert).toBe(1);
    expect(body.skipped_migrated).toBe(0);
    expect(getWrites()).toBe(0);
    expect(JSON.stringify(body)).not.toContain("OA 余额");
  });

  it("execute writes once then kill-switches to 404 when complete", async () => {
    const { client, getWrites } = mockGoalsClient([GOAL]);
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
    const { resetMigrateExecuteLockForTests } = await import(
      "@/lib/dashboard/migrate-goals"
    );
    resetMigrateExecuteLockForTests();

    const { POST } = await import("@/app/api/admin/migrate-goals/route");

    async function execOnce() {
      const binding = await createAgentTokenStepUpBinding({
        challengeId: CHALLENGE_ID,
        action: "migrate_goals_execute",
      });
      return POST(
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
          }),
        }),
      );
    }

    const first = await execOnce();
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      inserted: number;
      verify: { ok: boolean; decrypt_ok: number };
    };
    expect(firstBody.inserted).toBe(1);
    expect(firstBody.verify.ok).toBe(true);
    expect(firstBody.verify.decrypt_ok).toBe(1);
    expect(getWrites()).toBe(1);

    // After complete migration, endpoint returns 404 (kill switch).
    const second = await execOnce();
    expect(second.status).toBe(404);
  });

  it("execute is idempotent when blocks already exist (conflict skip)", async () => {
    const blockId = blockIdForGoal(GOAL.id);
    const { client, getWrites } = mockGoalsClient([GOAL], new Set([blockId]));
    // Force completeness check false so we can exercise execute path twice
    // while blocks already exist (RPC returns already_migrated / plan skips).
    vi.doMock("@/lib/dashboard/migrate-goals", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/dashboard/migrate-goals")
      >("@/lib/dashboard/migrate-goals");
      return {
        ...actual,
        isGoalsMigrationComplete: async () => false,
      };
    });
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
    const { resetMigrateExecuteLockForTests } = await import(
      "@/lib/dashboard/migrate-goals"
    );
    resetMigrateExecuteLockForTests();

    const { POST } = await import("@/app/api/admin/migrate-goals/route");
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "migrate_goals_execute",
    });
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
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inserted: number;
      skipped_migrated: number;
      verify: { ok: boolean };
    };
    expect(body.inserted).toBe(0);
    expect(body.skipped_migrated).toBe(1);
    expect(body.verify.ok).toBe(true);
    expect(getWrites()).toBe(0);
  });
});
