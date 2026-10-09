#!/bin/sh
set -e

echo "[meu-financeiro] aplicando migrações..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "[meu-financeiro] verificando seed inicial..."
node dist/prisma/seed.js

echo "[meu-financeiro] iniciando servidor..."
exec node dist/src/index.js
