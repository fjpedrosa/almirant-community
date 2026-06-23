#!/usr/bin/env bash
set -euo pipefail

# Dev local: levanta frontend + API apuntando a una DB local o configurada
# Uso: ./scripts/dev-local.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER:-almirant}:${POSTGRES_PASSWORD:-almirant_dev_password}@localhost:5432/${POSTGRES_DB:-almirant}}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-${POSTGRES_USER:-almirant}}"
DB_NAME="${DB_NAME:-${POSTGRES_DB:-almirant}}"

cleanup() {
  echo ""
  echo "Parando servicios..."
  kill $PID_API $PID_FRONTEND 2>/dev/null || true
  wait $PID_API $PID_FRONTEND 2>/dev/null || true
  echo "Listo."
}
trap cleanup EXIT INT TERM

echo "==> Verificando conexión a DB..."
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t 5 >/dev/null 2>&1; then
  echo "⚠️  No se puede conectar a la DB configurada."
  echo "    Host: $DB_HOST:$DB_PORT"
  echo "    Database: $DB_NAME"
  exit 1
fi
echo "    DB accesible ✓"

echo ""
echo "==> Levantando API (puerto 3001)..."
cd "$ROOT/backend"
DATABASE_URL="$DATABASE_URL" bun run dev:api &
PID_API=$!

echo "==> Levantando Frontend (puerto 3000)..."
cd "$ROOT/frontend"
DATABASE_URL="$DATABASE_URL" bun run dev &
PID_FRONTEND=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Frontend:  http://localhost:3000"
echo "  API:       http://localhost:3001"
echo "  DB:        $DB_HOST:$DB_PORT/$DB_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ctrl+C para parar ambos servicios"
echo ""

wait
