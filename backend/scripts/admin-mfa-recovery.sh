#!/usr/bin/env bash
#
# OPERATOR-ONLY admin TOTP MFA recovery (lost / replaced authenticator).
#
# NOT an API. NOT reachable from the frontend. There is deliberately NO public
# "forgot 2FA" endpoint: recovery requires shell access to the production
# database, an explicit confirmation variable, and it leaves an audit trail.
#
# What it does:
#   1. Resolves the TradeX user + linked Supabase identity by email.
#   2. Deletes that user's TOTP factors from Supabase Auth (auth.mfa_factors).
#      The old TOTP secret is destroyed, never read or printed.
#   3. Revokes that user's Supabase sessions, so no previously-issued AAL2
#      session can keep reaching admin APIs (Supabase does this itself when a
#      verified factor is deleted through its API; this replicates it for the
#      direct-SQL path).
#   4. Writes an ADMIN_MFA_RECOVERY row into admin_audit_logs (no secrets).
#
# The admin then re-enrolls with Google Authenticator through
# /admin/mfa/setup after a fresh password login.
#
# Usage:
#   ADMIN_EMAIL=admin@example.com \
#   CONFIRM_ADMIN_MFA_RECOVERY=yes \
#   ADMIN_MFA_RECOVERY_REASON="lost phone, identity verified on call #1234" \
#   npm run admin:mfa-recovery
#
# Requires DATABASE_URL (or DATABASE_HOST/PORT/NAME/USER/PASSWORD) in
# backend/.env. Requires enough privileges to read/write the Supabase `auth`
# schema.
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${ADMIN_EMAIL:-}"
CONFIRM="${CONFIRM_ADMIN_MFA_RECOVERY:-}"
REASON="${ADMIN_MFA_RECOVERY_REASON:-unspecified}"
OPERATOR="${ADMIN_MFA_RECOVERY_OPERATOR:-$(whoami 2>/dev/null || echo operator)}"

if [ -z "$EMAIL" ]; then
  echo "ADMIN_EMAIL is required (the admin who lost their authenticator)." >&2
  exit 1
fi

if [ "$CONFIRM" != "yes" ]; then
  echo "Refusing to run: set CONFIRM_ADMIN_MFA_RECOVERY=yes to confirm." >&2
  echo "Recovery removes the admin's TOTP factor and revokes their sessions." >&2
  exit 1
fi

# Escape single quotes for safe SQL string literals.
sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

EMAIL_SQL="$(sql_escape "$EMAIL")"
REASON_SQL="$(sql_escape "$REASON")"
OPERATOR_SQL="$(sql_escape "$OPERATOR")"

read -r -d '' SQL <<'EOSQL' || true
WITH target AS (
  SELECT u.id, u."authUserId", u.email, u.role, u.status
  FROM users u
  WHERE lower(u.email) = lower('__EMAIL__')
),
deleted_factors AS (
  DELETE FROM auth.mfa_factors f
  USING target t
  WHERE f.user_id = t."authUserId"
    AND f.factor_type = 'totp'
  RETURNING f.id
),
deleted_sessions AS (
  DELETE FROM auth.sessions s
  USING target t
  WHERE s.user_id = t."authUserId"
  RETURNING s.id
),
audit AS (
  INSERT INTO admin_audit_logs
    ("adminId", "action", "targetType", "targetId", "oldValue", "newValue",
     "ipAddress", "userAgent", "metadata")
  SELECT t.id,
         'ADMIN_MFA_RECOVERY',
         'admin_mfa',
         t.id::text,
         NULL,
         NULL,
         NULL,
         'operator-script',
         jsonb_build_object(
           'operator', '__OPERATOR__',
           'reason', '__REASON__',
           'method', 'operator-sql-recovery',
           'totpFactorsRemoved', (SELECT count(*) FROM deleted_factors),
           'sessionsRevoked', (SELECT count(*) FROM deleted_sessions)
         )
  FROM target t
  RETURNING id
)
SELECT
  t.email                                             AS email,
  t.role                                              AS role,
  t.status                                            AS status,
  (t."authUserId" IS NOT NULL)                        AS supabase_linked,
  (SELECT count(*) FROM deleted_factors)              AS totp_factors_removed,
  (SELECT count(*) FROM deleted_sessions)             AS sessions_revoked,
  (SELECT count(*) FROM audit)                        AS audit_rows_written
FROM target t;
EOSQL

SQL="${SQL//__EMAIL__/$EMAIL_SQL}"
SQL="${SQL//__OPERATOR__/$OPERATOR_SQL}"
SQL="${SQL//__REASON__/$REASON_SQL}"

echo "== Admin MFA recovery =="
echo "Target email : $EMAIL"
echo "Operator     : $OPERATOR"
echo "Reason       : $REASON"
echo "(No TOTP secret is read, printed or preserved.)"
echo

run_psql() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$SQL"
    return
  fi
  export PGHOST="${DATABASE_HOST:-localhost}"
  export PGPORT="${DATABASE_PORT:-5432}"
  export PGDATABASE="${DATABASE_NAME:-tradex}"
  export PGUSER="${DATABASE_USERNAME:-tradex_admin}"
  export PGPASSWORD="${DATABASE_PASSWORD:-}"
  psql -v ON_ERROR_STOP=1 -c "$SQL"
}

run_psql

echo
echo "Done. The admin must sign in again and re-enroll Google Authenticator at /admin/mfa/setup."
echo "An ADMIN_MFA_RECOVERY audit event was written to admin_audit_logs."