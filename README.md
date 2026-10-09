# Meu financeiro

Aplicação web pessoal (Node.js + Express + React/Vite + SQLite/Prisma) para acompanhar a vida
financeira de uma pessoa: fluxo de caixa mês a mês, mapa de dívidas, cenários editáveis, cartões e
contas lidos por Open Finance (Pluggy) e alertas por Telegram e e-mail.

Os dados que vêm no repositório são fictícios (`server/src/seedData.ts`), e os domínios e endereços
nos arquivos de `ops/` são de exemplo (`financeiro.example.com`, `203.0.113.10`, `100.x.y.z`) —
troque pelos seus.

## O que o app faz

- **Visão geral** — planilha mês a mês de entradas e saídas, com o que já foi pago reconhecido
  sozinho pelos lançamentos dos bancos, limites de gasto por categoria, dinheiro em conta, Pix que
  entrou e saiu e as faturas de cada cartão (fechada, aberta e previsão das próximas).
- **Dívidas** — mapa das dívidas com saldo, parcela, taxa e o que fazer com cada uma. A dívida de
  cartão é calculada sozinha a partir das faturas futuras.
- **Cartões** — para onde o dinheiro foi (por categoria e por lugar), gasto por dia, maiores
  compras, parcelamentos em andamento, tarifas e compras internacionais.
- **Open Finance** — conectar bancos, reconectar os que perderam a autorização e testar a
  qualidade de cada conexão.
- **Alertas** — avisos no app, no Telegram e por e-mail: fatura vencendo, conta atrasada, limite
  estourando, compra fora do padrão, banco desconectado, e um resumo diário ou semanal.
- **Cenários** — cópias do plano para simular ("e se a renda extra não vier?") sem mexer no principal.

É um app de **um usuário só**, pensado para rodar no seu próprio servidor. Não há cadastro: o
usuário e a senha ficam no arquivo `.env`.

## Instalação rápida (Docker)

Você precisa de uma máquina com Docker e o plugin `docker compose` (Linux, ou Windows/macOS com
Docker Desktop).

```bash
git clone https://github.com/vinhali/meu-financeiro.git
```

```bash
cd meu-financeiro && cp .env.example .env
```

Abra o `.env` e preencha pelo menos:

| Variável | O que colocar |
| --- | --- |
| `APP_USER` | o seu usuário de login |
| `APP_PASSWORD` | uma senha com **10 caracteres ou mais** (o app não sobe com senha curta ou de exemplo) |
| `SESSION_SECRET` | um valor aleatório longo: `openssl rand -hex 32` |
| `COOKIE_SECURE` | `false` para usar em `http://localhost`; `true` só atrás de HTTPS |
| `HOST_PORT` | porta local do app (padrão `8080`) |

Prepare a pasta de dados e a rede que o `docker-compose.yml` espera, e suba:

```bash
mkdir -p data && sudo chown 1000:1000 data && docker network create proxy_net
```

```bash
docker compose up -d --build
```

Abra `http://localhost:8080` e entre com o usuário e a senha do `.env`. Na primeira subida o app
cria o banco e quatro cenários de exemplo, com valores fictícios, para as telas não nascerem vazias.

> A porta fica aberta só para a própria máquina (`127.0.0.1`). Para acessar de fora, coloque um
> proxy com HTTPS na frente e mude `COOKIE_SECURE` para `true` — veja "Proxy reverso" mais abaixo
> ou, para um servidor inteiro do zero, [`ops/README.md`](ops/README.md).

## Primeiros passos no app

1. **Ajuste a planilha** (aba Visão geral): renomeie, apague e crie linhas de entrada e saída e
   preencha os valores de cada mês. Clique em um valor para editar.
2. **Ajuste as dívidas** (aba Dívidas): edite os cartões de exemplo ou apague e crie os seus.
3. **Conecte os bancos** (aba Open Finance) — opcional, mas é o que faz o app reconhecer sozinho
   o que foi pago e mostrar cartões e saldos. Passo a passo logo abaixo.
4. **Ligue os alertas** (aba Alertas) — também opcional.

Sem Open Finance o app funciona como uma planilha com cenários; com ele, os valores reais entram
sozinhos.

## Open Finance (Pluggy e MeuPluggy)

O app não fala direto com os bancos. Ele usa a [Pluggy](https://pluggy.ai), que entrega os dados
do Open Finance, por meio do **MeuPluggy** — o produto da Pluggy para a pessoa acessar os
próprios dados. São dois sites diferentes:

- **meu.pluggy.ai** — onde *você, pessoa física*, autoriza cada banco a compartilhar seus dados.
- **dashboard.pluggy.ai** — onde você cria uma "aplicação" e pega as chaves que este app usa.

### 1. Autorize os bancos no MeuPluggy

Em https://meu.pluggy.ai crie a conta e conecte cada banco. Você é levado ao app ou site do banco
para confirmar o compartilhamento (é o consentimento do Open Finance, com prazo de validade).

### 2. Crie a aplicação e pegue as chaves

Em https://dashboard.pluggy.ai crie uma aplicação, inclua o conector **MeuPluggy** na lista de
conectores e gere as credenciais (`client_id` e `client_secret`).

### 3. Coloque as chaves no `.env`

```
PLUGGY_CLIENT_ID=...
PLUGGY_CLIENT_SECRET=...
```

```bash
docker compose up -d
```

### 4. Conecte pelo app

Na aba **Open Finance**, clique em **Conectar banco**. O app cria a conexão na Pluggy e mostra um
link de autorização; abra, escolha o banco, confirme e volte para a tela, que acompanha os três
passos (autorização, coleta e carga). Repita para cada banco.

Se preferir, ou se o botão não funcionar para algum banco, dá para registrar pelo terminal uma
conexão criada no app de demonstração do dashboard da Pluggy (anote o **item id** dela):

```bash
docker exec meu-financeiro node dist/src/openfinance/cli.js add <itemId>
```

A primeira carga traz até 12 meses de histórico (`PLUGGY_HISTORY_DAYS`).

### Como os dados se atualizam

- A Pluggy atualiza as conexões do MeuPluggy **uma vez por dia**, de madrugada. O app busca o que
  já está lá a cada `PLUGGY_SYNC_INTERVAL_HOURS` (padrão 6 horas). Uma compra de hoje normalmente
  aparece amanhã.
- **Reconectar**: a autorização do banco vence (em geral em 12 meses) e às vezes cai antes. A aba
  Open Finance mostra a situação de cada banco e o botão de reconectar; o que já foi carregado é
  mantido.
- **Testar conexão**: confere se o banco respondeu há pouco, se a autorização está válida e se
  vieram contas e lançamentos.
- Nem todo banco entrega tudo. Alguns não mandam os lançamentos do cartão, e pagamentos feitos com
  cartão-benefício ou em carteiras que não participam do Open Finance não aparecem — nesses casos
  use o "marcar como pago" da planilha.

Pelo terminal:

```bash
docker exec meu-financeiro node dist/src/openfinance/cli.js status
```

```bash
docker exec meu-financeiro node dist/src/openfinance/cli.js sync
```

Detalhes para quem for mexer no código: os dados ficam espelhados nas tabelas `of_*` do SQLite,
com valores em centavos e o JSON original de cada registro na coluna `raw`; cada sincronização
fica registrada em `of_sync_runs`.

### Como o app reconhece o que foi pago

Uma linha da planilha só sai do total do mês quando há **prova**: um pagamento em conta ou uma
compra no cartão cujo nome bate com a linha (por exemplo, a linha "Internet" e um débito da
operadora). Coincidência só de valor não basta, e "marcar como pago" à mão é conferido no dia
seguinte contra os bancos — se nenhum banco confirmar, a marca cai. A regra é conservadora de
propósito: é melhor uma conta aparecer como pendente do que sumir do total sem ter sido paga.

## Alertas

O app olha os dados a cada 15 minutos e cria um alerta quando encontra algo que merece atenção.
Cada fato gera um alerta só (não repete), e todos aparecem no **sino** no topo da tela. Telegram e
e-mail são opcionais e podem ser ligados juntos.

### O que gera alerta

| Alerta | Quando | Ajuste |
| --- | --- | --- |
| Fatura vencendo | três dias antes do vencimento e no dia | — |
| Conta fixa atrasada | passou do dia em que costuma sair e nenhum banco mostra o pagamento | — |
| Dinheiro não cobre a semana | o saldo em conta é menor que o que vence nos próximos 7 dias | — |
| Limites de gasto | ritmo acima do limite, perto do limite e estourado | a partir de quantos % do limite |
| Compra fora do padrão | compra única bem acima do seu tíquete médio | valor mínimo |
| Parcelamento novo | compra parcelada nova, com quanto compromete por mês | — |
| O mês piorou | o fechamento de um mês caiu de um dia para o outro | queda mínima |
| Dados dos bancos | banco sem atualizar, desconectado ou com a autorização vencendo | horas sem atualizar |

Cada um pode ser desligado na aba **Alertas**, em "O que avisar".

### Quando chegam

- **Resumo** — diário ou semanal (você escolhe o dia), no horário que definir, no fuso de
  Brasília. Traz saldo, vencimentos da semana, limites, compras novas e como cada mês fecha. Como
  os bancos são lidos de madrugada, um horário antes das 06:00 traria dados de anteontem.
- **Urgente na hora** — fatura vencendo hoje, dinheiro que não cobre a semana e banco desconectado
  saem assim que são detectados, sem esperar o resumo. Pode ser desligado.

### Telegram

1. No Telegram, fale com o **@BotFather**, mande `/newbot`, escolha um nome e copie o token.
2. Na aba **Alertas**, cole o token no cartão Telegram e salve. O app confere o token com o
   Telegram antes de guardar.
3. Abra o seu bot, mande `/start` e, no app, clique em **Vincular conversa**. Só conversas
   privadas são aceitas, para os valores não irem parar em um grupo.
4. Clique em **Enviar teste**.

### E-mail

Na aba **Alertas**, cartão E-mail:

- **Enviar para** — um ou mais endereços (até 10). Digite e aperte Enter, ou cole vários separados
  por vírgula.
- **Servidor de envio (SMTP)** — no Gmail: servidor `smtp.gmail.com`, porta `587`, usuário = o seu
  e-mail e, como senha, uma **senha de app** (Conta Google › Segurança › Verificação em duas
  etapas › Senhas de app). A senha normal da conta não funciona.

Salve e clique em **Enviar teste**.

### Onde ficam o token e a senha

O token do bot e a senha do SMTP digitados no app são guardados **cifrados** no banco
(AES-256-GCM, com chave derivada do `SESSION_SECRET`) e nunca voltam para a tela. Se você trocar o
`SESSION_SECRET`, precisa digitá-los de novo.

Também dá para configurar tudo por variáveis de ambiente (`TELEGRAM_BOT_TOKEN`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `APP_URL`); o que for gravado pelo app
vale mais. Em um servidor, `ops/set-alert-secrets.sh` pergunta esses valores sem mostrá-los na tela.

## Login em dois passos

Assim que existir um canal de alerta funcionando (Telegram vinculado ou e-mail configurado), o
login passa a pedir, depois da senha, um **código de 6 dígitos** enviado pelo Telegram — ou por
e-mail, se o Telegram falhar. O código vale 5 minutos, uma vez só, e morre depois de 5 erros.

- Tentativa de login recusada gera um aviso para você (no máximo um a cada 10 minutos).
- **Sair** encerra todas as sessões abertas, em qualquer aparelho.
- Se os canais caírem e o código não chegar: coloque `LOGIN_2FA=off` no `.env` e rode
  `docker compose up -d`. Religue depois.

## Stack

- **Backend:** Express + TypeScript + Prisma (SQLite)
- **Frontend:** React + Vite + TypeScript (build estático servido pelo próprio Express)
- **Autenticação:** usuário/senha únicos via variáveis de ambiente, sessão em cookie
  `httpOnly` assinado (JWT)
- **Empacotamento:** uma única imagem Docker (multi-stage), `docker-compose` para subir
  com volume persistente

## Estrutura do projeto

```
.
├── client/          # Frontend React/Vite (TypeScript)
├── server/          # Backend Express + Prisma (TypeScript)
├── Dockerfile        # Build multi-stage (frontend + backend) → imagem única
├── docker-compose.yml
├── ops/               # Deploy, backup, proxy e preparação do servidor
└── .env.example       # Variáveis de ambiente para o docker-compose
```

## Desenvolvimento local (sem Docker, com Node.js instalado)

Pré-requisitos: Node.js 20+.

### 1. Backend

```bash
cd server
cp .env.example .env     # ajuste APP_USER / APP_PASSWORD / SESSION_SECRET se quiser
npm install
npm run prisma:generate
npm run prisma:migrate:dev   # cria o banco SQLite em server/data/dev.db
npm run seed                 # popula os 4 cenários iniciais (idempotente)
npm run dev                  # inicia o servidor em http://localhost:8080
```

### 2. Frontend

Em outro terminal:

```bash
cd client
npm install
npm run dev   # inicia o Vite em http://localhost:5173 (proxy /api -> :8080)
```

Acesse `http://localhost:5173` e faça login com o `APP_USER`/`APP_PASSWORD` definidos
no `server/.env`.

## Produção em uma VPS (com Docker)

Pré-requisitos: Docker e Docker Compose (plugin `docker compose`).

### 1. Configurar variáveis de ambiente

Na raiz do projeto:

```bash
cp .env.example .env
```

Edite o `.env` e defina:

- `APP_USER` / `APP_PASSWORD` — credenciais de login da aplicação (usuário único).
- `LOGIN_2FA` — o login pede um código de 6 dígitos (Telegram; e-mail como reserva) sempre que houver canal de alerta configurado. `LOGIN_2FA=off` desliga, para emergência.
- `SESSION_SECRET` — segredo aleatório para assinar o cookie de sessão. Gere com:
  ```bash
  openssl rand -hex 32
  ```
- `COOKIE_SECURE` — deixe `false` se for acessar via HTTP simples (ex.: só na rede
  interna ou via túnel SSH). Mude para `true` **somente** se a aplicação estiver
  atrás de um proxy HTTPS (Nginx/Caddy com TLS) — caso contrário o navegador não
  enviará o cookie de sessão e o login não vai "colar".
- `HOST_PORT` — porta do host que será mapeada para a aplicação (padrão `8080`).

### 2. Subir a aplicação

```bash
docker compose up -d --build
```

Isso vai:

1. Buildar o frontend (Vite) e o backend (Express/Prisma) em estágios separados.
2. Gerar a imagem final `meu-financeiro:latest`, contendo o backend + o build
   estático do frontend.
3. Ao iniciar o container, rodar automaticamente:
   - `prisma migrate deploy` (aplica migrações pendentes no banco SQLite);
   - o seed inicial (cria os 4 cenários só se o banco estiver vazio — é idempotente,
     não sobrescreve dados existentes);
   - o servidor Express na porta interna `8080`.

### 3. Acessar

```
https://financeiro.example.com
```

Faça login com o `APP_USER`/`APP_PASSWORD` configurados no `.env`.

> O container expõe a porta interna `8080` apenas em `127.0.0.1:${HOST_PORT}` (padrão
> `8089`) — o acesso público é feito via reverse proxy nginx (ver seção
> "Proxy reverso" abaixo). `COOKIE_SECURE=true` está habilitado, então o login só
> funciona através do domínio HTTPS, não diretamente pela porta `8089`.

## Onde os dados ficam

O banco SQLite vive em `./data/financeiro.db` (na raiz do projeto, no host), montado
como volume Docker em `/app/data/financeiro.db` dentro do container. Esse arquivo
**persiste** entre `docker compose down`/`up` e entre rebuilds da imagem — só é
perdido se a pasta `./data` for apagada manualmente.

## Backup e restauração

A aplicação tem botões na seção "Backup" do dashboard:

- **Exportar cenário atual** — baixa um `.json` com os dados (itens, dívidas, ponte)
  do cenário selecionado.
- **Baixar backup completo** — baixa um `.json` único com todos os cenários.
- **Importar JSON** — aceita tanto um export de cenário único quanto um backup
  completo (`{ "scenarios": [...] }`). Cenários importados são criados como novos
  cenários (não-base), com sufixo `(importado N)` se o nome já existir — nada é
  sobrescrito.

Além disso, é possível fazer backup/restauração diretamente do arquivo SQLite:

```bash
# Backup (com a aplicação rodando, SQLite em modo WAL é seguro de copiar)
cp ./data/financeiro.db ./data/financeiro.db.bak-$(date +%Y%m%d)

# Restauração: pare a aplicação, substitua o arquivo e suba novamente
docker compose down
cp ./data/financeiro.db.bak-AAAAMMDD ./data/financeiro.db
docker compose up -d
```

## Atualizando a aplicação (deploy)

O código vive em `github.com/vinhali/meu-financeiro`. A VM não tem credenciais do
GitHub: o deploy envia o commit atual a partir da máquina local.

```bash
SSH_TARGET=root@100.x.y.z SSH_KEY=~/.ssh/id_ed25519_vps ops/deploy.sh
```

O SSH da VM só responde pelo Tailscale (`100.x.y.z`); a máquina que faz o deploy precisa
estar na mesma conta. Para montar uma VM nova do zero, veja [`ops/README.md`](ops/README.md).

O script envia `git archive HEAD` para `/opt/financeiro` (sem tocar em `.env` nem
em `./data`), copia o banco para `/var/backups/financeiro/pre-deploy-*.db`,
rebuilda a imagem e só termina com sucesso se `/api/health` responder.

As migrações do Prisma são aplicadas automaticamente na inicialização
(`prisma migrate deploy`), e o seed só roda se o banco estiver vazio.

## Backup automático (Google Drive)

`ops/backup.sh` roda todo dia às 03:17 (UTC-5) via `/etc/cron.d/financeiro-backup`:

1. tira um snapshot consistente com `sqlite3 .backup` e valida com `integrity_check`;
2. guarda em `/var/backups/financeiro/` (14 dias);
3. envia para o Google Drive em `Backups/financeiro/` via rclone (90 dias).

O envio para o Drive usa um remote do rclone chamado `gdrive` (escopo `drive.file`:
o rclone só enxerga os arquivos que ele mesmo criou). Para recriar o acesso:

```bash
# na máquina local (com navegador): cria o remote e faz o login no Google
rclone config create gdrive drive scope=drive.file
rclone config reconnect gdrive: --auto-confirm
# copia a configuração (contém o token) para a VM
scp "$APPDATA/rclone/rclone.conf" root@100.x.y.z:/root/.config/rclone/rclone.conf
```

> O remote usa o `client_id` compartilhado do rclone, que o próprio rclone avisa que
> será desativado ao longo de 2026. Se o envio começar a falhar, crie um `client_id`
> próprio (https://rclone.org/drive/#making-your-own-client-id) e refaça o login.

Log em `/var/log/financeiro-backup.log`. Para restaurar: pare o container,
descompacte o `.db.gz` escolhido sobre `./data/financeiro.db` (dono uid 1000) e suba de novo.

## Open Finance — referência da API

Rotas autenticadas usadas pela interface: `GET /api/openfinance/status`,
`POST /api/openfinance/sync`, `POST /api/openfinance/connect`,
`POST /api/openfinance/connections/:id/reconnect`, `POST /api/openfinance/connections`
(`{ "itemId": "..." }`). A sincronização usa `GET /v2/transactions` da Pluggy (com cursor).

## Lint e CI

`.github/workflows/lint.yml` roda em todo push/PR: ESLint, typecheck (server e
client), testes do backend e `npm audit` das dependências de produção. Localmente:

```bash
npm ci && npm ci --prefix server && npm ci --prefix client
(cd server && npx prisma generate)
npm run lint && npm run typecheck && npm test --prefix server
```

## Logs e troubleshooting

```bash
docker compose logs -f          # acompanhar logs do container
docker compose ps               # status do container
docker compose restart          # reiniciar sem rebuildar
```

## Proxy reverso (produção: financeiro.example.com)

Em produção, esta aplicação roda atrás do nginx compartilhado da VPS
(`proxy_nginx`, definido em `/opt/proxy/docker-compose.yml` e
`/opt/proxy/conf.d/vps.conf`), que também serve `site.example.com`. A configuração
versionada está em `ops/nginx/vps.conf`.

Como está conectado:

- O container `meu-financeiro` está conectado a **duas** redes Docker: a rede própria
  (`financeiro_default`) e a rede do nginx compartilhado (`proxy_net`),
  declarada como `external: true` no `docker-compose.yml`.
- O `nginx.conf` compartilhado tem um bloco `server` para `financeiro.example.com`
  (porta 443) que faz `proxy_pass http://meu-financeiro:8080` (resolução via DNS
  interno do Docker, `resolver 127.0.0.11`).
- Um bloco na porta 80 redireciona `http://financeiro.example.com` para HTTPS e
  serve o desafio ACME (`/.well-known/acme-challenge/`) a partir de
  `/opt/proxy/certbot`.
- O certificado TLS fica em `/opt/proxy/ssl/financeiro.example.com.{crt,key}` e é
  renovado automaticamente (ver abaixo).

### Renovação dos certificados (automática)

Os certificados de `financeiro.example.com` e `site.example.com` são
gerenciados pelo certbot **do host** (`/etc/letsencrypt`), no modo webroot
(`/opt/proxy/certbot`, servido pelo nginx em `/.well-known/acme-challenge/`).

- `certbot.timer` (systemd) roda `certbot renew` duas vezes por dia e renova o que
  estiver a menos de 30 dias do vencimento.
- A cada renovação, o deploy hook `/etc/letsencrypt/renewal-hooks/deploy/proxy-nginx.sh`
  (versionado em `ops/certbot/deploy-hook.sh`) copia o certificado para `/opt/proxy/ssl/`
  e recarrega o `proxy_nginx`.

```bash
certbot certificates          # validade de cada certificado
certbot renew --dry-run       # ensaio completo da renovação (não troca nada)
systemctl list-timers certbot.timer
```

> Depois de editar `/opt/proxy/conf.d/vps.conf`:
> `docker exec proxy_nginx nginx -t && docker exec proxy_nginx nginx -s reload`.

### Rodando sem o nginx compartilhado (standalone)

Se quiser rodar esta aplicação isolada (sem o nginx da VPS), remova a rede
`proxy_net` do `docker-compose.yml`, exponha a porta normalmente
(`'${HOST_PORT:-8080}:8080'`, sem `127.0.0.1:`) e use seu próprio proxy:

### Caddy (mais simples — TLS automático via Let's Encrypt)

`Caddyfile`:

```
plano.seudominio.com {
    reverse_proxy localhost:8080
}
```

```bash
caddy run --config Caddyfile
```

### Nginx

```nginx
server {
    listen 80;
    server_name plano.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois configure TLS (ex.: `certbot --nginx`).

**Importante:** se usar HTTPS via proxy reverso, defina `COOKIE_SECURE=true` no
`.env` e suba a aplicação novamente (`docker compose up -d`), para que o cookie de
sessão seja marcado como `Secure`.

## Segurança

- Usuário único (`APP_USER`/`APP_PASSWORD`). Em produção o servidor **não sobe**
  com senha padrão/curta (< 10 caracteres) ou `SESSION_SECRET` de exemplo/curto (< 32).
- Login com limite de 10 falhas por IP a cada 15 min (aplicação) e 10 req/min (nginx);
  comparação de credenciais em tempo constante.
- Segundo fator: depois da senha, um código de 6 dígitos sai pelo Telegram (e-mail como
  reserva); vale 5 minutos, uma vez, e morre após 5 erros. `LOGIN_2FA=off` desliga.
- Sair encerra todas as sessões emitidas antes, em qualquer aparelho.
- Login recusado avisa o dono pelos canais de alerta (no máximo um aviso a cada 10 min).
- Token do Telegram e senha SMTP gravados pelo app ficam cifrados no banco (AES-256-GCM).
- VM: de fora só as portas 80 e 443; SSH apenas pelo Tailscale e só por chave; atualizações
  de segurança automáticas; TLS 1.2/1.3 só com cifras AEAD. Tudo aplicado por `ops/provision.sh`.
- Cookie de sessão `httpOnly`, `SameSite=Strict`, `Secure` atrás de HTTPS; requisições
  que alteram estado precisam ter `Origin` igual ao host.
- Cabeçalhos via `helmet` (CSP, HSTS, `X-Frame-Options`...).
- Container sem root (uid 1000), filesystem somente leitura, sem capabilities.
- Todas as rotas de dados (`/api/scenarios/*`, `/api/openfinance/*`, `/api/alerts/*`) exigem sessão autenticada.
- Nunca rode `npm run dev` na VM: os servidores de desenvolvimento escutam em
  `0.0.0.0` com a senha de exemplo.
