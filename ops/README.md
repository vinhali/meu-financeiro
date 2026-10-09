# Operação: recriar o servidor do zero

Tudo o que a produção usa está neste repositório, menos os segredos e os dados. Este guia leva
uma VM vazia (Ubuntu 24.04) até o site no ar com os dados restaurados.

## O que está no repositório e o que não está

| No repositório | Onde |
| --- | --- |
| Aplicação (imagem Docker, migrações do banco) | `Dockerfile`, `docker-compose.yml`, `server/prisma/migrations` |
| Proxy nginx (TLS, limite de login, cifras) | `ops/nginx/vps.conf`, `ops/nginx/docker-compose.yml` |
| Instalação do certificado renovado | `ops/certbot/deploy-hook.sh` |
| Backup diário e agendamento | `ops/backup.sh`, `ops/cron/financeiro-backup` |
| Preparação da VM (Docker, firewall, Tailscale, SSH, atualizações) | `ops/provision.sh` |
| Deploy | `ops/deploy.sh` |
| Canais de alerta pelo terminal (opcional; o app também configura) | `ops/set-alert-secrets.sh` |

| Fora do repositório (guarde você) | Onde vive na VM |
| --- | --- |
| Segredos: senha do app, `SESSION_SECRET`, chaves da Pluggy, token do Telegram, senha SMTP | `/opt/financeiro/.env` |
| Banco de dados | `/opt/financeiro/data/financeiro.db` (cópias em `/var/backups/financeiro` e no Google Drive, `Backups/financeiro/`) |
| Acesso do rclone ao Google Drive | `/root/.config/rclone/rclone.conf` |
| Certificados TLS | `/etc/letsencrypt` (reemitidos do zero, não precisam de cópia) |
| Conta do Tailscale | login feito uma vez por máquina |

> **`SESSION_SECRET` importa na restauração.** O token do Telegram e a senha SMTP gravados pela
> aba Alertas ficam cifrados no banco com uma chave derivada dele. Com um `SESSION_SECRET`
> diferente o app sobe normalmente, mas esses dois segredos precisam ser digitados de novo
> (ou vir das variáveis `TELEGRAM_BOT_TOKEN` / `SMTP_PASS` no `.env`).

## Passo a passo

Na sua máquina, dentro do repositório. `VM` é o IP público da máquina nova.

### 1. Enviar o repositório e preparar a VM

```bash
git archive --format=tar HEAD | ssh root@VM "mkdir -p /opt/financeiro && tar -xf - -C /opt/financeiro"
```

```bash
ssh root@VM "bash /opt/financeiro/ops/provision.sh"
```

Na primeira vez o script para no Tailscale. Entre na conta e rode o script de novo para ele
fechar o firewall e deixar o SSH só por chave:

```bash
ssh root@VM "tailscale up --hostname=vps-financeiro"
```

```bash
ssh root@VM "bash /opt/financeiro/ops/provision.sh"
```

A partir daqui o SSH só responde pelo endereço do Tailscale (`tailscale ip -4` na VM, algo como
`100.x.y.z`). A sua máquina precisa estar na mesma conta do Tailscale.

### 2. Segredos

```bash
scp .env.example root@100.x.y.z:/opt/financeiro/.env
```

Edite `/opt/financeiro/.env` na VM (`chmod 600`). Em produção: `COOKIE_SECURE=true`,
`HOST_PORT=8089`, `APP_URL=https://financeiro.example.com`, senha com 10 caracteres ou mais e
`SESSION_SECRET` com 32 ou mais — de preferência **o mesmo** da VM antiga (ver aviso acima).

### 3. DNS e certificados

Aponte o registro A de `financeiro.example.com` para o IP público da VM. Depois, na VM, com o
proxy ainda parado (a porta 80 precisa estar livre):

```bash
certbot certonly --standalone -d financeiro.example.com --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/proxy-nginx.sh
```

Isso emite o certificado e já o copia para `/opt/proxy/ssl/`. Para as renovações seguintes
funcionarem com o proxy no ar, troque para o modo webroot:

```bash
certbot reconfigure --cert-name financeiro.example.com --webroot -w /opt/proxy/certbot
```

`ops/nginx/vps.conf` também serve `site.example.com` (temporário). Se a VM nova
não for hospedar esse site, apague o bloco dele e o nome dele no bloco da porta 80 antes de
subir o proxy; se for, emita o certificado dele do mesmo jeito e copie o site para
`/opt/proxy/sites/site`.

### 4. Subir o proxy

```bash
cd /opt/proxy && docker compose up -d && docker exec proxy_nginx nginx -t
```

### 5. Restaurar o banco

Pegue o backup mais recente (Google Drive `Backups/financeiro/`, ou `/var/backups/financeiro`
da VM antiga) e coloque no lugar, antes do primeiro deploy:

```bash
gunzip -c financeiro-AAAAMMDD.db.gz > /opt/financeiro/data/financeiro.db && chown 1000:1000 /opt/financeiro/data/financeiro.db
```

Sem esse passo o app sobe com um banco vazio e cria os cenários de exemplo.

### 6. Deploy

Da sua máquina:

```bash
SSH_TARGET=root@100.x.y.z SSH_KEY=~/.ssh/id_ed25519_vps ops/deploy.sh
```

O script só termina com sucesso se `/api/health` responder. As migrações do banco rodam
sozinhas na subida.

### 7. Backup no Google Drive

Copie o `rclone.conf` (ver "Backup automático" no README principal) e teste:

```bash
ssh root@100.x.y.z "/opt/financeiro/ops/backup.sh && tail -3 /var/log/financeiro-backup.log"
```

### 8. Conferir

- `https://financeiro.example.com` abre e o login pede o código no Telegram;
- aba **Open Finance**: bancos conectados e teste de conexão verde (as conexões ficam no banco
  restaurado; as chaves da Pluggy, no `.env`);
- aba **Alertas**: Telegram vinculado, e-mail ativo, "Enviar teste" chega;
- de fora do Tailscale, `ssh root@VM` não responde; `ufw status` mostra só 80, 443 e 41641/udp.

## Emergências

- **Tailscale caiu e o SSH não entra:** use o console do provedor da VM e rode `ufw disable`.
- **Não chega o código do login:** no `.env`, `LOGIN_2FA=off` e `docker compose up -d` em
  `/opt/financeiro`. Religue depois de consertar o canal.
- **Sessão roubada ou aparelho perdido:** entre e clique em sair — isso encerra todas as sessões.
  Para trocar a senha, edite `APP_PASSWORD` no `.env` e suba o container de novo.
