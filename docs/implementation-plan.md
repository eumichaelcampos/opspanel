# OpsPanel — Plano de implementação

Versão: 1.0  
Data: 29 de julho de 2026  
Fonte normativa: `OpsPanel_PRD_Discovery_Arquitetura_UIUX_v1.0` (docx/pdf na raiz do repositório)

## 1. Resumo do produto

OpsPanel é um **control plane** web para administrar múltiplos servidores Linux com [WordOps](https://github.com/WordOps/WordOps). O painel traduz operações de CLI em **fluxos tipados**, **jobs assíncronos**, **auditoria** e **verificação pós-execução**, sem terminal arbitrário no navegador.

**North star do MVP:** conectar servidor → inventariar → criar site → acompanhar job → validar estado real no servidor.

## 2. Pontos-chave do PRD

| Área | Decisão do PRD |
|------|----------------|
| Execução | Agente Go local, outbound mTLS, allowlist; evitar senha SSH permane no painel (alvo) |
| Operações | Commands tipados com schema, locks, idempotência, verificação independente |
| WordOps | Adapter versionado; capabilities por discovery; argv, não shell interpolada |
| Jobs | BullMQ/Redis; estados incl. validating, verifying; SSE para eventos |
| Segurança | MFA TOTP P0 no MVP PRD; envelope/KMS para segredos; RBAC object-level |
| UI | Glassmorphism controlado, WCAG AA, desktop-first, tokens definidos |
| API | `/api/v1`, Problem Details, Idempotency-Key, OpenAPI |

## 3. Tensões e resoluções para este repositório

| Tema | PRD | Briefing Fase 1 | Resolução |
|------|-----|-----------------|-----------|
| Conexão servidor | Agente + bootstrap token | SSH + credenciais criptografadas + teste de conexão | **Fase 1:** `RemoteExecutor` com implementação **SSH** real para onboarding e teste. **Fase 2:** agente mTLS conforme PRD. Ver ADR-002. |
| MFA TOTP | P0 no MVP PRD | Auth básica na Fase 1 | Estrutura de usuário preparada; MFA na **Fase 1.5 / início Fase 2**. |
| Nome | OpsPanel provisório | OpsPanel | Manter codename; revisão de marca antes de lançamento público. |

## 4. Arquitetura (visão)

Três camadas:

1. **Control Plane** — `apps/web`, `apps/api`: auth, org, RBAC, API REST, UI.
2. **Orchestrator** — módulos em API + `apps/worker`: jobs, locks, retries, auditoria.
3. **Execution Layer** — `packages/wordops` + `RemoteExecutor`: SSH (Fase 1), agente (Fase 2).

## 5. Fases de entrega

### Fase 0 — Documentação e fundação (atual)

- Monorepo, Compose, Prisma, auth, RBAC mínimo, layout UI, servidores, teste de conexão via job.
- **Critério:** fluxo login → cadastrar servidor → testar conexão → ver job e auditoria.

### Fase 2 — Agente e inventário

- Bootstrap token, binário agente (Go), mTLS, heartbeat, capability discovery, sync de sites.
- Deprecar armazenamento permanente de senha SSH onde o agente substituir bootstrap.

### Fase 3 — Job engine completo + sites

- Locks por recurso, SSE completo, list/detail site, wizard create (HTML/PHP/MySQL/WP).

### Fase 4 — Operações recorrentes

- PHP, cache, SSL, enable/disable, backups pré-op, FTPS.

### Fase 5 — Integrações e hardening

- Cloudflare, S3/Restic, notificações, E2E em VMs WordOps, pentest, a11y audit.

## 6. Critérios de aceite — Fase 1

- [ ] `pnpm install`, `docker compose up`, migrate/seed, web + api + worker sobem sem erro.
- [ ] Login com sessão HTTP-only; usuário admin seed; organização padrão.
- [ ] CRUD mínimo de servidor (create/list); credencial nunca retornada pela API após gravação.
- [ ] `POST /api/v1/servers/:id/test-connection` cria job; worker executa SSH real; eventos persistidos.
- [ ] UI: lista servidores, formulário, timeline do job (polling ou SSE inicial).
- [ ] Audit log para login, criação de servidor e teste de conexão.
- [ ] Typecheck, lint e testes unitários/integração básicos passando.

## 7. Backlog imediato pós-Fase 1

1. ~~SSE estável para jobs (`Last-Event-ID`).~~ Implementado em `GET /jobs/:id/events` + fetch stream na web.
2. ~~Detecção WordOps + versão no teste de conexão.~~ Já no teste SSH (`wo version`).
3. Spike agente Go (inventory + mTLS).
4. MFA TOTP (FR-AUTH-002).
5. ~~Sync de sites existentes.~~ Job `server.inventory.sync` + modelo `Site`.

### Próximo slice recomendado

- Detalhe de site com `wo site info` (job tipado + parser).
- Enriquecimento do inventário (tipo, PHP, cache) por site.
- Idempotency-Key em POST operacionais.

## 8. Comandos de validação (raiz do monorepo)

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```

## 9. Referências

- PRD: `OpsPanel_PRD_Discovery_Arquitetura_UIUX_v1.0.docx`
- Arquitetura: `docs/architecture/system-architecture.md`
- ADRs: `docs/decisions/`
