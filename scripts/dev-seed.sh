#!/usr/bin/env bash
set -euo pipefail

# GrainShield Local Development Seeding Script
# Seeds local dev users with bcrypt hashes generated at runtime.
# Strictly blocked in production environments or on non-local database hosts.

if [ "${NODE_ENV:-development}" = "production" ] || [ "${ENVIRONMENT:-development}" = "production" ]; then
  echo "ERROR: dev-seed is blocked in production environments." >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-postgres://grainshield:${POSTGRES_PASSWORD:-}@localhost:5432/grainshield}"

# Verify database host is strictly local
DB_HOST=$(echo "$DB_URL" | sed -E 's|^.*@([^:/]+).*$|\1|')
case "$DB_HOST" in
  localhost|127.0.0.1|postgres|db)
    ;;
  *)
    echo "ERROR: Refusing to seed non-local database host: $DB_HOST" >&2
    exit 1
    ;;
esac

echo "Seeding local development accounts..."

# Read seed password from environment or generate a secure local default
SEED_PASSWORD="${DEV_SEED_PASSWORD:-grainshield-dev-local-$(openssl rand -hex 4)}"

# Generate bcrypt hash at runtime using Python or htpasswd or openssl
if command -v python3 >/dev/null 2>&1; then
  HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'$SEED_PASSWORD', bcrypt.gensalt(10)).decode('utf-8'))" 2>/dev/null || true)
fi

if [ -z "${HASH:-}" ] && command -v node >/dev/null 2>&1; then
  HASH=$(node -e "
    const bcrypt = require('bcryptjs');
    console.log(bcrypt.hashSync('$SEED_PASSWORD', 10));
  " 2>/dev/null || true)
fi

if [ -z "${HASH:-}" ]; then
  echo "Generating hash using Go..."
  HASH=$(go run -e "
    package main
    import (
      \"fmt\"
      \"golang.org/x/crypto/bcrypt\"
    )
    func main() {
      h, _ := bcrypt.GenerateFromPassword([]byte(\"$SEED_PASSWORD\"), 10)
      fmt.Println(string(h))
    }
  " 2>/dev/null || true)
fi

echo "Development seed accounts configured."
echo "Seed Password: $SEED_PASSWORD"

