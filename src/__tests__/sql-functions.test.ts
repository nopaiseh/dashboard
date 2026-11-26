import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://dashboard:dashboard@127.0.0.1:5432/dashboard";
const SQL_FILE = "supabase/tests/rpc_smoke.sql";

function canReachPostgres(): boolean {
  try {
    execFileSync(
      "psql",
      [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", "SELECT 1"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

describe("SQL RPC smoke (local Postgres)", () => {
  it("runs rpc_smoke.sql against migrated schema", () => {
    if (!existsSync(SQL_FILE)) {
      throw new Error(`missing ${SQL_FILE}`);
    }
    if (!canReachPostgres()) {
      throw new Error(
        `Postgres unreachable at ${DATABASE_URL}; start local PG or set DATABASE_URL`,
      );
    }

    const out = execFileSync(
      "psql",
      [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    expect(out).toContain("OK rpc_smoke");
  });
});
