# OpsPanel

**Control plane open source para servidores Linux com [WordOps](https://wordops.net).**

Gerencie VPS, provisione stacks, crie sites WordPress, monitore recursos, opere via jobs assíncronos e integre com IA (assistente + MCP server).

[![CI](https://github.com/your-org/opspanel/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/opspanel/actions/workflows/ci.yml)

![OpsPanel](docs/product/README.md)

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

### Instalação via terminal (GitHub)

**Recomendado:** use o assistente em http://localhost:3002/install (app `landing`, após `pnpm dev`) para escolher IP, domínio ou subdomínio e gerar `.env`, Nginx/Caddy e comandos.

Ou manualmente:

```bash
git clone https://github.com/your-org/opspanel.git
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

- **Landing comercial:** http://localhost:3002
- **Wizard instalação:** http://localhost:3002/install
- **Painel:** http://localhost:3000/login
- **API:** http://localhost:3001/api/v1
- **Swagger (dev):** http://localhost:3001/api/docs

> A landing (`apps/landing`) é deploy independente do painel. Configure `NEXT_PUBLIC_PANEL_URL` na landing para apontar ao painel em produção.

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

Dockerfiles em `infra/docker/` (`Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.web`, `Dockerfile.landing`).

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
  web/      Next.js 15 painel (produto)
  landing/  Next.js 15 site comercial + wizard de instalação
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
