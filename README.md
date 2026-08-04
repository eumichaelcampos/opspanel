# OpsPanel

**Control plane open source para servidores Linux com [WordOps](https://wordops.net).**

Gerencie VPS, provisione stacks, crie sites WordPress, monitore recursos, opere via jobs assíncronos e integre com IA (assistente + MCP server).

[![CI](https://github.com/eumichaelcampos/opspanel/actions/workflows/ci.yml/badge.svg)](https://github.com/eumichaelcampos/opspanel/actions/workflows/ci.yml)

## Recursos

| Módulo | Capacidades |
|--------|-------------|
| **Servidores** | SSH criptografado, onboarding wizard, stack ops, health/metrics Netdata, console SSH, reboot/maintenance |
| **Sites** | Criação WP/HTML/PHP, SSL, backup, FTP, file manager SFTP, troca de domínio |
| **Operações** | Jobs BullMQ + SSE, auditoria, relatórios |
| **Integrações** | Assistente IA, MCP server (`@opspanel/mcp-server`), API keys |
| **Segurança** | Sessão HttpOnly, Argon2, RBAC, rate limit, secrets validation em produção |

## Quick start (desenvolvimento)

### Pré-requisitos

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- Docker (PostgreSQL 16 + Redis 7)

### Instalação

```bash
git clone https://github.com/eumichaelcampos/opspanel.git
cd opspanel
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# Gere chaves fortes
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Edite .env: SESSION_SECRET, CREDENTIALS_ENCRYPTION_KEY, SEED_ADMIN_*

docker compose -f infra/docker/docker-compose.yml up -d

# Linux/macOS
chmod +x scripts/install.sh && ./scripts/install.sh

# Windows
./scripts/install.ps1
```

### Desenvolvimento

```bash
pnpm dev
```

- **Painel:** http://localhost:3000/login
- **API:** http://localhost:3001/api/v1
- **Swagger (dev):** http://localhost:3001/api/docs

Login inicial (seed): `admin@localhost` / `ChangeMe123!`

### Licença e planos

Cada instalação usa uma **LICENSE_KEY** (mesmo no plano free). Gere com:

```bash
node scripts/generate-license.mjs free
```

Cole `LICENSE_KEY`, `LICENSE_PLAN`, `LICENSE_SIGNING_SECRET` e `LICENSE_ENTITLEMENTS_JWT` no `.env`.

Limites por plano (servidores, sites, jobs/mês, API keys, IA) são aplicados na API. Veja uso em **Configurações → Plano e uso**.

Em produção, `LICENSE_KEY` é **obrigatória**.

### License Cloud (M2)

Serviço separado em `Desktop/opspanel-license` (porta **3003**):

```bash
cd ../opspanel-license
copy .env.example .env
npm install && npm run db:push && npm run db:seed && npm run dev
```

No `.env` do OpsPanel:

```env
LICENSE_SERVER_URL=http://localhost:3003
LICENSE_SIGNING_SECRET=dev-license-signing-secret-32chars!
LICENSE_KEY=<chave gerada pelo seed>
```

### Billing / Stripe (M3)

No License Cloud, configure Stripe para checkout e portal de assinatura:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_BUSINESS=price_...
BILLING_SUCCESS_URL=http://localhost:3000/settings/plan?billing=success
BILLING_CANCEL_URL=http://localhost:3000/settings/plan?billing=cancel
BILLING_PORTAL_RETURN_URL=http://localhost:3000/settings/plan
```

Webhook Stripe: `POST https://license.seudominio.com/v1/billing/webhook`

No painel: **Configurações → Plano e uso** → escolha Pro/Business ou **Gerenciar assinatura** (portal Stripe).

### Publisher Admin (M4) + Setup inicial

O OpsPanel é **self-hosted** (cada cliente instala no servidor dele). A conexão com você é via **licença + heartbeat**.

| Plataforma | Porta | Quem usa |
|------------|-------|----------|
| OpsPanel | 3000 | Cliente (instalação local/VPS) |
| License Cloud API | 3003 | Backend (activate/heartbeat/billing) |
| **Publisher Admin** | 3004 | **Você** (licenças, instâncias, telemetria) |
| Site comercial | 3002 | Marketing |

**First-run:** http://localhost:3000/setup (conta admin + licença free via License Cloud)

**Publisher:** http://localhost:3004 (`publisher@localhost` / ver seed do License Cloud)

Coloque no `.env` do OpsPanel após setup:

```env
LICENSE_SERVER_URL=http://localhost:3003
LICENSE_KEY=<chave do setup ou seed>
```

## Produção

### Variáveis obrigatórias

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
API_URL=https://api.seudominio.com
WEB_URL=https://panel.seudominio.com
SESSION_SECRET=<random 32+ chars>
CREDENTIALS_ENCRYPTION_KEY=<base64 32 bytes>
```

Em produção, valores padrão de `.env.example` são **rejeitados** na inicialização.

### Build e start

```bash
pnpm build
pnpm --filter @opspanel/database exec prisma migrate deploy
pnpm --filter @opspanel/api start &
pnpm --filter @opspanel/worker start &
pnpm --filter @opspanel/web start
```

### Docker

Dockerfiles em `infra/docker/` (`Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.web`).

Use reverse proxy (Nginx/Caddy) com HTTPS na frente do Next.js (3000) e API (3001).

### MCP (Cursor / Claude Desktop)

Gere uma API key em **Configurações → Conta & API** e configure:

```json
{
  "mcpServers": {
    "opspanel": {
      "command": "npx",
      "args": ["-y", "@opspanel/mcp-server"],
      "env": {
        "OPSPANEL_API_URL": "https://api.seudominio.com",
        "OPSPANEL_API_KEY": "opk_..."
      }
    }
  }
}
```

## Estrutura do monorepo

```
apps/
  api/      NestJS + Fastify REST API
  web/      Next.js 15 painel
  worker/   BullMQ + SSH/WordOps
packages/
  config/   Validação env (Zod)
  contracts/ OperationKeys + schemas
  database/ Prisma + migrations
  security/ Argon2 + AES-GCM
  wordops/  Adapter SSH/Netdata
  mcp-server/ MCP para IA externa
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | API + worker + web (Turbo) |
| `pnpm build` | Build de produção |
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Vitest |
| `pnpm db:migrate` | Prisma migrate dev |
| `pnpm db:seed` | Admin inicial |

## Segurança

Consulte [SECURITY.md](SECURITY.md). Reporte vulnerabilidades de forma responsável.

## Documentação

- [Arquitetura](docs/architecture/system-architecture.md)
- [Plano de implementação](docs/implementation-plan.md)
- [ADRs](docs/decisions/)

## Licença

MIT — veja [LICENSE](LICENSE).

## WordOps

OpsPanel orquestra [WordOps](https://wordops.net) (`wo` CLI). WordOps continua sendo instalado e executado **no servidor gerenciado**; OpsPanel é o painel de controle centralizado.
