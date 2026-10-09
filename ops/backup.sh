#!/usr/bin/env bash
# Backup diário do SQLite do financeiro: snapshot consistente, cópia local com
# retenção e envio para o Google Drive via rclone.
#
# Instalado na VM em /opt/financeiro/ops/backup.sh e chamado por
# /etc/cron.d/financeiro-backup. Requer: sqlite3, gzip, rclone.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/financeiro}"
DB_FILE="${DB_FILE:-$APP_DIR/data/financeiro.db}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/financeiro}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-14}"
# Remote do rclone (criado com `rclone config`) e pasta de destino no Drive.
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_PATH="${RCLONE_PATH:-Backups/financeiro}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-90}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

[ -f "$DB_FILE" ] || { log "ERRO: banco não encontrado em $DB_FILE"; exit 1; }

umask 077
mkdir -p "$LOCAL_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
snapshot="$LOCAL_DIR/financeiro-$stamp.db"

# .backup usa a API de backup online do SQLite: seguro com a aplicação rodando (inclusive em WAL).
sqlite3 "$DB_FILE" ".timeout 10000" ".backup '$snapshot'"
check="$(sqlite3 "$snapshot" 'PRAGMA integrity_check;')"
if [ "$check" != "ok" ]; then
  log "ERRO: integrity_check falhou no snapshot: $check"
  rm -f "$snapshot"
  exit 1
fi
gzip -9 "$snapshot"
log "snapshot local: $snapshot.gz ($(stat -c %s "$snapshot.gz") bytes)"

find "$LOCAL_DIR" -name 'financeiro-*.db.gz' -mtime "+$LOCAL_KEEP_DAYS" -delete

if ! rclone listremotes 2>/dev/null | grep -qx "$RCLONE_REMOTE:"; then
  log "ERRO: remote '$RCLONE_REMOTE' do rclone não configurado — backup ficou só local."
  exit 2
fi

rclone copy "$snapshot.gz" "$RCLONE_REMOTE:$RCLONE_PATH" --quiet
rclone lsf "$RCLONE_REMOTE:$RCLONE_PATH/$(basename "$snapshot.gz")" >/dev/null
rclone delete "$RCLONE_REMOTE:$RCLONE_PATH" --min-age "${REMOTE_KEEP_DAYS}d" --include 'financeiro-*.db.gz' --quiet
log "enviado para $RCLONE_REMOTE:$RCLONE_PATH"
