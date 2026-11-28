#!/usr/bin/env bash
# Prove migration 0005 refuses to drop non-empty public.goals, then succeeds when empty.
#
# Guard-first verification (do not edit applied 0005):
#   1) Exercise the emptiness guard first (non-empty goals => 0005 raises).
#   2) After that failed run, assert lock infra still exists (single-transaction rollback).
#   3) Clear rows and re-apply 0005 successfully.
#
# Convention for future destructive migrations: put the emptiness/safety guard at the
# very top of the migration file (before any DROP/ALTER that removes dependent objects).
# Migration 0005 already shipped to prod with the guard after lock drops; we do not
# rewrite applied migrations — this script verifies guard + rollback semantics instead.
# See also README (destructive migrations / emptiness guard).
#
# Requires: psql, DATABASE_URL (or PG* env), postgresql-client.
# Creates a throwaway database so the main CI DB can keep a full migration replay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL required}"
GUARD_DB="${GUARD_DB:-dashboard_drop_goals_guard}"

psql_main() {
  PGPASSWORD="${PGPASSWORD:-}" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

# Derive a URL pointing at GUARD_DB (replace final path segment).
GUARD_URL="$(python3 - <<PY
from urllib.parse import urlsplit, urlunsplit
u = urlsplit("$DATABASE_URL")
print(urlunsplit((u.scheme, u.netloc, "/$GUARD_DB", u.query, u.fragment)))
PY
)"

psql_guard() {
  PGPASSWORD="${PGPASSWORD:-}" psql "$GUARD_URL" -v ON_ERROR_STOP=1 "$@"
}

echo "== drop_goals_guard: recreate $GUARD_DB =="
psql_main -c "DROP DATABASE IF EXISTS ${GUARD_DB};"
psql_main -c "CREATE DATABASE ${GUARD_DB};"

psql_guard -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql_guard -c "DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
psql_guard -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
psql_guard -c "DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"

mapfile -t MIGRATIONS < <(ls -1 "$ROOT"/supabase/migrations/*.sql | sort)
DROP_GOALS=""
DROP_GOALS_IDX=-1
for i in "${!MIGRATIONS[@]}"; do
  base="$(basename "${MIGRATIONS[$i]}")"
  if [[ "$base" == *drop_goals* ]]; then
    DROP_GOALS="${MIGRATIONS[$i]}"
    DROP_GOALS_IDX=$i
    break
  fi
done
if [[ -z "$DROP_GOALS" || $DROP_GOALS_IDX -lt 1 ]]; then
  echo "expected a drop_goals migration after at least one prior migration" >&2
  exit 1
fi

echo "== apply migrations through pre-drop (before $(basename "$DROP_GOALS")) =="
for f in "${MIGRATIONS[@]:0:$DROP_GOALS_IDX}"; do
  echo "Applying $f"
  psql_guard --single-transaction -f "$f"
done

echo "== insert leftover goals row (bypass read-only triggers) =="
psql_guard <<'SQL'
ALTER TABLE public.goals DISABLE TRIGGER ALL;
INSERT INTO public.goals (area, title) VALUES ('guard-smoke', 'must-block-drop');
ALTER TABLE public.goals ENABLE TRIGGER ALL;
SQL

# --- First exercise: emptiness guard must raise (before any success-path drops) ---
echo "== expect 0005 to FAIL while goals non-empty (emptiness guard first) =="
set +e
psql_guard --single-transaction -f "$DROP_GOALS" > /tmp/drop-goals-guard-fail.out 2>&1
status=$?
set -e
if [[ $status -eq 0 ]]; then
  echo "expected migration 0005 to fail when goals has rows" >&2
  cat /tmp/drop-goals-guard-fail.out >&2
  exit 1
fi
if ! grep -q "refusing to drop public.goals: table still has rows" /tmp/drop-goals-guard-fail.out; then
  echo "expected refuse-to-drop message missing from output:" >&2
  cat /tmp/drop-goals-guard-fail.out >&2
  exit 1
fi
echo "OK: non-empty guard raised"

echo "== after failed 0005: lock table + RPCs must still exist (txn rollback) =="
psql_guard <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.app_run_locks') IS NULL THEN
    RAISE EXCEPTION 'app_run_locks missing after failed drop_goals (expected rollback)';
  END IF;
  IF to_regprocedure('public.try_acquire_migrate_goals_lock(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'try_acquire_migrate_goals_lock missing after failed drop_goals';
  END IF;
  IF to_regprocedure('public.release_migrate_goals_lock(text)') IS NULL THEN
    RAISE EXCEPTION 'release_migrate_goals_lock missing after failed drop_goals';
  END IF;
END $$;
SQL
echo "OK: lock infra retained after failed run"

echo "== clear goals and re-apply 0005 =="
psql_guard <<'SQL'
ALTER TABLE public.goals DISABLE TRIGGER ALL;
DELETE FROM public.goals;
ALTER TABLE public.goals ENABLE TRIGGER ALL;
SQL
psql_guard --single-transaction -f "$DROP_GOALS"

psql_guard -c "SELECT to_regclass('public.goals') IS NULL AS goals_gone;" | grep -q t
echo "OK: drop_goals_guard smoke passed"
