#!/usr/bin/env bash
# Primary proof runner for business-profile-restructure (see ../PROOF.md).
# Provisions a fresh throwaway Postgres in Docker, applies the repo's Prisma
# migrations to it, then runs the behavioral proof (proof.ts) against that
# database. The container is removed on exit, pass or fail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
NAME="bpr-proof-pg-$$"
PORT="${BPR_PROOF_PG_PORT:-55432}"
URL="postgresql://postgres:proof@127.0.0.1:${PORT}/proof"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== fresh postgres (${NAME}) on :${PORT}"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=proof \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U postgres -d proof >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && { echo "FAIL postgres never became ready"; exit 1; }
  sleep 1
done

echo "== prisma migrate deploy against fresh database"
cd "$ROOT"
DATABASE_URL="$URL" npx prisma migrate deploy

echo "== behavioral proof"
DATABASE_URL="$URL" BPR_PROOF=1 npx tsx docs/features/business-profile-restructure/proof/proof.ts
