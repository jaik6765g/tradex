#!/usr/bin/env bash
# Operator-only admin bootstrap. NOT an API. NOT frontend-accessible.
# Usage:
#   ADMIN_EMAIL=admin@example.com npm run admin:grant        # promote existing user
#   ADMIN_EMAIL=admin@example.com ADMIN_MOBILE=+919999999999 npm run admin:revoke
#
# Requires DATABASE_URL (or DATABASE_HOST/PORT/NAME/USER/PASSWORD) in backend/.env.
# Never handles passwords — Supabase owns credentials; this only flips users.role.
set -euo pipefail
cd "$(dirname "$0")/.."

ACTION="${1:-grant}"
EMAIL="${ADMIN_EMAIL:-}"

if [ -z "$EMAIL" ]; then
  echo "ADMIN_EMAIL is required" >&2
  exit 1
fi

ROLE="user"
if [ "$ACTION" = "grant" ]; then ROLE="admin"; fi

SQL="UPDATE users SET role='$ROLE' WHERE lower(email)=lower('$EMAIL'); SELECT id, email, role, status FROM users WHERE lower(email)=lower('$EMAIL');"

if [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$SQL"
  exit 0
fi

export PGHOST="${DATABASE_HOST:-localhost}"
export PGPORT="${DATABASE_PORT:-5432}"
export PGDATABASE="${DATABASE_NAME:-tradex}"
export PGUSER="${DATABASE_USERNAME:-tradex_admin}"
export PGPASSWORD="${DATABASE_PASSWORD:-}"
psql -v ON_ERROR_STOP=1 -c "$SQL"
