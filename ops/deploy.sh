#!/usr/bin/env bash
# Deploy do commit atual (HEAD) para a VM, a partir da máquina local.
# Uso: SSH_TARGET=root@host [SSH_KEY=~/.ssh/chave] ops/deploy.sh
#
# Envia `git archive HEAD` (só arquivos versionados — .env e ./data da VM não são
# tocados), tira um snapshot do banco, rebuilda a imagem e valida o healthcheck.
set -euo pipefail

SSH_TARGET="${SSH_TARGET:?defina SSH_TARGET, ex.: root@203.0.113.10}"
APP_DIR="${APP_DIR:-/opt/financeiro}"
SSH_OPTS=(-o BatchMode=yes)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Há alterações não commitadas; faça commit antes do deploy." >&2
  exit 1
fi
sha="$(git rev-parse HEAD)"
echo "Deploy de $sha para $SSH_TARGET:$APP_DIR"

git archive --format=tar HEAD | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p '$APP_DIR' && tar -xf - -C '$APP_DIR' && echo '$sha' > '$APP_DIR/.deployed-sha'"

ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "APP_DIR='$APP_DIR' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"
chmod 600 .env
chmod +x ops/*.sh server/docker-entrypoint.sh
mkdir -p data
if [ -f data/financeiro.db ]; then
  mkdir -p /var/backups/financeiro
  cp -p data/financeiro.db "/var/backups/financeiro/pre-deploy-$(date -u +%Y%m%d-%H%M%S).db"
fi
# O container roda como uid 1000 ("node").
chown -R 1000:1000 data
docker compose up -d --build
port="$(grep -E '^HOST_PORT=' .env | cut -d= -f2)"
port="${port:-8080}"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    echo "healthcheck OK"
    # Sem isso, imagens antigas e cache de build enchem o disco da VM a cada deploy.
    docker image prune -f >/dev/null
    docker builder prune -f --filter until=72h >/dev/null
    exit 0
  fi
  sleep 2
done
echo "healthcheck FALHOU" >&2
docker compose logs --tail 40
exit 1
REMOTE
