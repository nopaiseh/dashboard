#!/usr/bin/env bash
# Prove migration 0005 refuses to drop non-empty public.goals, then succeeds when empty.
# Requires: psql, DATABASE_URL (or PG* env), postgresql-client.
# Creates a throwaway database so the main CI DB can keep a full 0001–0005 replay.
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
if [[ ${#MIGRATIONS[@]} -lt 2 ]]; then
  echo "expected multiple migrations" >&2
  exit 1
fi
LAST="${MIGRATIONS[-1]}"
if [[ "$(basename "$LAST")" != *drop_goals* ]]; then
  echo "expected last migration to be drop_goals, got $LAST" >&2
  exit 1
fi

echo "== apply migrations through pre-drop =="
for f in "${MIGRATIONS[@]:0:${#MIGRATIONS[@]}-1}"; do
  echo "Applying $f"
  psql_guard --single-transaction -f "$f"
done

echo "== insert leftover goals row (bypass read-only triggers) =="
psql_guard <<'SQL'
ALTER TABLE public.goals DISABLE TRIGGER ALL;
INSERT INTO public.goals (area, title) VALUES ('guard-smoke', 'must-block-drop');
ALTER TABLE public.goals ENABLE TRIGGER ALL;
SQL

echo "== expect 0005 to FAIL while goals non-empty =="
set +e
psql_guard --single-transaction -f "$LAST" > /tmp/drop-goals-guard-fail.out 2>&1
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

echo "== clear goals and re-apply 0005 =="
psql_guard <<'SQL'
ALTER TABLE public.goals DISABLE TRIGGER ALL;
DELETE FROM public.goals;
ALTER TABLE public.goals ENABLE TRIGGER ALL;
SQL
psql_guard --single-transaction -f "$LAST"

psql_guard -c "SELECT to_regclass('public.goals') IS NULL AS goals_gone;" | grep -q t
echo "OK: drop_goals_guard smoke passed"
