#!/usr/bin/env bash
# Prepara uma VM nova (Ubuntu 24.04) para rodar o financeiro igual à de produção:
# Docker, proxy nginx, certbot, backup diário, firewall, Tailscale, SSH só por chave e
# atualizações automáticas. Pode rodar de novo sem medo: cada passo confere antes de mudar.
#
# Rodar NA VM, como root, com o repositório já em /opt/financeiro (ver ops/README.md):
#
#   bash /opt/financeiro/ops/provision.sh
#
# O que este script NÃO faz (são segredos ou dependem de você): criar o .env, entrar na conta
# do Tailscale, emitir os certificados, restaurar o banco e configurar o rclone.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/financeiro}"
PROXY_DIR="${PROXY_DIR:-/opt/proxy}"
[ "$(id -u)" = 0 ] || { echo "Rode como root." >&2; exit 1; }
[ -f "$APP_DIR/ops/provision.sh" ] || { echo "Não achei o repositório em $APP_DIR." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n== %s\n' "$1"; }

step "Pacotes"
# Algumas VMs vêm com um fuso que não existe na base do sistema; isso trava o apt (pacote tzdata).
if ! timedatectl show -p Timezone --value 2>/dev/null | grep -q '/'; then
  ln -sfn /usr/share/zoneinfo/Etc/UTC /etc/localtime
  echo Etc/UTC > /etc/timezone
fi
apt-get update -q
apt-get install -y -q sqlite3 gzip curl rclone certbot ufw unattended-upgrades
# Não troca um Docker que já esteja instalado (ex.: o docker-ce do repositório oficial).
command -v docker >/dev/null || apt-get install -y -q docker.io docker-compose-v2
docker compose version >/dev/null
systemctl enable --now docker

step "Atualizações automáticas de segurança"
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades

step "Pastas e rede do Docker"
mkdir -p "$APP_DIR/data" "$PROXY_DIR"/{conf.d,ssl,certbot,sites/site} /var/backups/financeiro /root/.config/rclone
chown -R 1000:1000 "$APP_DIR/data" # o container roda como uid 1000 ("node")
docker network inspect proxy_net >/dev/null 2>&1 || docker network create proxy_net

step "Proxy nginx"
install -m 644 "$APP_DIR/ops/nginx/docker-compose.yml" "$PROXY_DIR/docker-compose.yml"
install -m 644 "$APP_DIR/ops/nginx/vps.conf" "$PROXY_DIR/conf.d/vps.conf"

step "Certbot: instala o certificado renovado no proxy"
install -D -m 755 "$APP_DIR/ops/certbot/deploy-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/proxy-nginx.sh

step "Backup diário"
chmod +x "$APP_DIR"/ops/*.sh
install -m 644 "$APP_DIR/ops/cron/financeiro-backup" /etc/cron.d/financeiro-backup

step "Tailscale"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled
if tailscale ip -4 >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 | head -1)"
  echo "Conectado: $TS_IP"
else
  TS_IP=""
  echo "Ainda não está na sua conta. Rode:  tailscale up --hostname=vps-financeiro"
  echo "abra o link que aparecer e depois rode este script de novo para fechar o firewall."
fi

step "Firewall e SSH"
if [ -n "$TS_IP" ]; then
  # De fora: só 80 e 443 (sites) e a porta do Tailscale. O SSH entra apenas pelo Tailscale.
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow in on tailscale0 >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 41641/udp >/dev/null
  ufw --force enable >/dev/null
  ufw status | head -1
  if [ -s /root/.ssh/authorized_keys ]; then
    printf '# Acesso só por chave. Para desfazer, apague este arquivo e rode: systemctl reload ssh\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-hardening.conf
    sshd -t && systemctl reload ssh
    echo "SSH: só por chave."
  else
    echo "SSH: /root/.ssh/authorized_keys está vazio — mantive o login por senha para você não ficar de fora."
  fi
else
  echo "Pulado: o firewall só fecha a porta 22 depois que o Tailscale estiver conectado."
fi

step "Pronto. Falta, nesta ordem (detalhes em ops/README.md):"
cat <<EOF
1. $APP_DIR/.env (copie do .env.example e preencha; chmod 600)
2. Certificados: certbot certonly --standalone -d <domínio>  (antes de subir o proxy)
3. Proxy: cd $PROXY_DIR && docker compose up -d
4. Banco: restaure o backup em $APP_DIR/data/financeiro.db (dono 1000:1000)
5. App: da sua máquina, rode ops/deploy.sh apontando para esta VM
6. Backup no Drive: copie o rclone.conf para /root/.config/rclone/
EOF
