#!/bin/sh
set -e

SECRETS_FILE="/app/data/secrets.env"
mkdir -p /app/data

# Generate a secret only if it's missing or empty in the file
need_regen=0
if [ ! -s "$SECRETS_FILE" ]; then
  need_regen=1
else
  # shellcheck disable=SC1090
  . "$SECRETS_FILE" 2>/dev/null || need_regen=1
  if [ -z "$ENCRYPTION_SECRET" ] || [ -z "$SESSION_SECRET" ]; then
    need_regen=1
  fi
fi

if [ "$need_regen" = "1" ]; then
  echo "Generating new secrets at $SECRETS_FILE..."
  ENC=$(openssl rand -hex 32)
  SESS=$(openssl rand -hex 32)
  printf 'ENCRYPTION_SECRET=%s\nSESSION_SECRET=%s\n' "$ENC" "$SESS" > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi

# Load secrets and export them so child processes inherit them
# shellcheck disable=SC1090
. "$SECRETS_FILE"
export ENCRYPTION_SECRET SESSION_SECRET

# Sanity check
if [ -z "$ENCRYPTION_SECRET" ] || [ -z "$SESSION_SECRET" ]; then
  echo "ERROR: Failed to load secrets from $SECRETS_FILE" >&2
  exit 1
fi
echo "Secrets loaded (ENCRYPTION_SECRET length=${#ENCRYPTION_SECRET}, SESSION_SECRET length=${#SESSION_SECRET})"

echo "Running database migrations..."
pnpm --filter @workspace/db run push-force

echo "Starting API server..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
