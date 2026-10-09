#!/usr/bin/env bash
# Deploy hook do certbot (host): instalado em
# /etc/letsencrypt/renewal-hooks/deploy/proxy-nginx.sh
#
# O certbot chama este script a cada certificado renovado, com RENEWED_LINEAGE
# apontando para /etc/letsencrypt/live/<domínio>. Copia o certificado para onde o
# container proxy_nginx lê e recarrega o nginx.
set -euo pipefail

SSL_DIR="${SSL_DIR:-/opt/proxy/ssl}"
domain="$(basename "${RENEWED_LINEAGE:?RENEWED_LINEAGE não definido}")"

case "$domain" in
  financeiro.example.com | site.example.com) ;;
  *) exit 0 ;;
esac

umask 077
# Escreve em arquivo temporário e renomeia: o nginx nunca vê um par crt/key pela metade.
install -m 644 "$RENEWED_LINEAGE/fullchain.pem" "$SSL_DIR/$domain.crt.new"
install -m 600 "$RENEWED_LINEAGE/privkey.pem" "$SSL_DIR/$domain.key.new"
mv -f "$SSL_DIR/$domain.crt.new" "$SSL_DIR/$domain.crt"
mv -f "$SSL_DIR/$domain.key.new" "$SSL_DIR/$domain.key"

# Na primeira emissão (VM nova) o proxy ainda não está no ar: o certificado já fica no lugar.
if ! docker ps --format '{{.Names}}' | grep -qx proxy_nginx; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] certificado de $domain instalado (proxy_nginx parado, nada a recarregar)"
  exit 0
fi
docker exec proxy_nginx nginx -t
docker exec proxy_nginx nginx -s reload
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] certificado de $domain instalado e nginx recarregado"
