# OpsPanel

**Control plane open source para servidores Linux com [WordOps](https://wordops.net).**

Gerencie VPS, provisione stacks, crie e migre sites WordPress, valide DNS, monitore recursos, opere via jobs assíncronos e integre com IA (assistente + MCP server).

[![CI](https://github.com/eumichaelcampos/opspanel/actions/workflows/ci.yml/badge.svg)](https://github.com/eumichaelcampos/opspanel/actions/workflows/ci.yml)

## Recursos

| Módulo | Capacidades |
|--------|-------------|
| **Servidores** | SSH criptografado, onboarding wizard, stack WordOps, health/metrics Netdata, console SSH, reboot/maintenance |
| **Sites** | Criação WP/HTML/PHP, SSL, inventário, migração FTP/SFTP, alerta DNS/Cloudflare, backup, file manager SFTP |
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

- **Painel:** http://localhost:3000
- **API:** http://localhost:3001/api/v1
- **Swagger (dev):** http://localhost:3001/api/docs

Na primeira execução, abra o painel e conclua o **setup** (conta admin + ativação da licença free).

Em ambientes já seedados: `admin@localhost` / `ChangeMe123!` (altere antes de produção).

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

Em produção, valores padrão de `.env.example` são **rejeitados** na inicialização. A licença é configurada no fluxo de setup do painel (ou via `LICENSE_KEY` no `.env`).

### Build e start (PM2)

```bash
pnpm build
pnpm --filter @opspanel/database exec prisma migrate deploy
pm2 start scripts/deploy-vps/ecosystem.config.cjs
pm2 save
```

### Restart automático após reboot (obrigatório em VPS)

Garante que Docker (Postgres/Redis) e PM2 (api/web/worker) voltem sozinhos:

```bash
sudo bash scripts/enable-boot-restart.sh
```

Isso habilita:
- `docker` no boot + `restart: unless-stopped` nos containers
- `pm2-root.service`
- `opspanel-boot.service` (sobe compose, espera o banco e restaura o PM2)

Instalação completa em VPS Ubuntu também já chama esse passo via `scripts/deploy-vps/install-remote.sh`.

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
