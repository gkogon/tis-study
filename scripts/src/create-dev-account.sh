#!/bin/bash
#
# Create a dev account on prod with infinite study quota.
#
# Wraps the /tis-api/auth/signup endpoint with the bot-defense fields
# (honeypot + form-load timestamp + Turnstile bypass) that the public
# form would normally provide. After signup, calls psql to attach a
# firm row with study_limit / seat_limit = 999_999.
#
# Usage:
#   bash scripts/src/create-dev-account.sh [<email-tag> [<password>]]
#
# Defaults:
#   email-tag: devN where N is a random 4-hex suffix
#   password:  a 16-char memorable string with mixed case + digits + !
#
# Env:
#   Requires `railway login` to be active (uses railway CLI to fetch
#   the prod DATABASE_PUBLIC_URL).

set -euo pipefail

TAG="${1:-dev$(openssl rand -hex 2)}"
PASSWORD="${2:-DevInfinite2026!}"
EMAIL="gkogon6+${TAG}@gmail.com"
API="https://simpleimpactstudies.com/tis-api"

# formLoadedAt must be >= 2 sec in the past; use 10 sec to be safe.
FORM_LOADED_AT=$(( $(date +%s%3N) - 10000 ))

echo "=== Creating dev account ==="
echo "  email: $EMAIL"
echo "  password: $PASSWORD"
echo

RESP=$(curl -s -X POST "$API/auth/signup" \
  -H "Content-Type: application/json" \
  --data-raw "{
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"firstName\": \"Dev\",
    \"lastName\": \"${TAG^}\",
    \"website\": \"\",
    \"formLoadedAt\": $FORM_LOADED_AT
  }")

USERID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user']['id'] if 'user' in d else '')" 2>/dev/null || true)

if [ -z "$USERID" ]; then
  echo "❌ Signup failed:"
  echo "$RESP"
  exit 1
fi
echo "✓ User created: $USERID"

echo "=== Attaching firm with infinite quota ==="
DB_URL=$(railway variables --service Postgres --kv 2>/dev/null | grep "^DATABASE_PUBLIC_URL=" | cut -d= -f2-)
if [ -z "${DB_URL:-}" ]; then
  echo "❌ Could not read DATABASE_PUBLIC_URL — run 'railway login' and retry."
  exit 1
fi

SLUG="dev-${TAG}-$(openssl rand -hex 4)"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL >/dev/null
WITH new_firm AS (
  INSERT INTO firms (name, slug, plan_tier, study_limit, seat_limit, studies_used_this_period)
  VALUES ('Dev ${TAG^}', '$SLUG', 'growth', 999999, 999999, 0)
  RETURNING id
)
INSERT INTO firm_members (firm_id, user_id, role)
SELECT id, '$USERID', 'owner' FROM new_firm;
SQL
echo "✓ Firm attached with study_limit=999999 / seat_limit=999999"

echo
echo "=== Verify ==="
psql "$DB_URL" -c "SELECT u.email, f.name AS firm, f.plan_tier, f.study_limit, f.seat_limit, fm.role
                   FROM users u
                   JOIN firm_members fm ON fm.user_id = u.id
                   JOIN firms f ON f.id = fm.firm_id
                   WHERE u.email = '$EMAIL';"

echo
echo "============================================"
echo "✓ DEV ACCOUNT READY"
echo "  Email:    $EMAIL"
echo "  Password: $PASSWORD"
echo "  Login:    https://simpleimpactstudies.com/login"
echo "============================================"
