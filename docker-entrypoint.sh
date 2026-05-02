#!/bin/sh
set -e

SECRETS_FILE="/app/data/secrets.env"
mkdir -p /app/data

# Generate and persist secrets on first run (or if missing)
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Generating new secrets at $SECRETS_FILE..."
  {
    echo "ENCRYPTION_SECRET=$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"
    echo "SESSION_SECRET=$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi

# Load secrets from file (only if not already set via environment)
. "$SECRETS_FILE"
export ENCRYPTION_SECRET SESSION_SECRET

echo "Running database migrations..."
pnpm --filter @workspace/db run push-force

echo "Starting API server..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
