#!/usr/bin/env bash
# Configura os canais dos alertas (Telegram e e-mail) no servidor, sem expor os segredos:
# pergunta cada valor no terminal (sem eco para token e senha), grava em /opt/financeiro/.env
# com permissão 600 e reinicia o app. Rodar NA VM, como root:
#
#   bash /opt/financeiro/ops/set-alert-secrets.sh
#
# Deixar uma resposta em branco mantém o valor que já existe (ou deixa o canal desligado).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/financeiro}"
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "Não achei $ENV_FILE" >&2; exit 1; }

set_var() { # nome, valor
  local name="$1" value="$2" tmp
  [ -n "$value" ] || return 0
  tmp="$(mktemp)"
  grep -v "^${name}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

echo "== Telegram =="
echo "Crie um bot com o @BotFather (/newbot) e cole o token que ele devolver."
read -r -s -p "Token do bot (não aparece na tela): " tg_token; echo
set_var TELEGRAM_BOT_TOKEN "$tg_token"

echo
echo "== E-mail (SMTP) =="
echo "Para Gmail: host smtp.gmail.com, porta 587, usuário = seu e-mail, senha = uma 'senha de app'"
echo "(Conta Google > Segurança > Verificação em duas etapas > Senhas de app)."
read -r -p "Servidor SMTP [enter para pular]: " smtp_host
if [ -n "$smtp_host" ]; then
  read -r -p "Porta [587]: " smtp_port
  read -r -p "Usuário (e-mail de envio): " smtp_user
  read -r -s -p "Senha (não aparece na tela): " smtp_pass; echo
  read -r -p "Enviar os alertas para qual e-mail? [$smtp_user]: " mail_to
  set_var SMTP_HOST "$smtp_host"
  set_var SMTP_PORT "${smtp_port:-587}"
  set_var SMTP_USER "$smtp_user"
  set_var SMTP_PASS "$smtp_pass"
  set_var ALERT_EMAIL_TO "${mail_to:-$smtp_user}"
fi

echo
read -r -p "Endereço do app, para o link no fim das mensagens [https://financeiro.example.com]: " app_url
set_var APP_URL "${app_url:-https://financeiro.example.com}"

chmod 600 "$ENV_FILE"
echo
echo "Reiniciando o app..."
(cd "$APP_DIR" && docker compose up -d --force-recreate >/dev/null)
echo "Pronto. Agora, no Telegram, abra o seu bot e mande /start; depois, no app, clique no sino > 'vincular'."
