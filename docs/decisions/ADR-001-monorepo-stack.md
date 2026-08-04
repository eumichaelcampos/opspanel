# ADR-001: Monorepo, stack e ferramentas

Status: Aceito  
Data: 2026-07-29

## Contexto

O PRD define monorepo TypeScript com Next.js, NestJS, worker, agente Go separado, PostgreSQL, Redis e BullMQ.

## Decisão

- **pnpm workspaces** + **Turborepo** para orquestração de build/test.
- **TypeScript strict** em apps e packages.
- **Next.js App Router** (web), **NestJS + Fastify** (api), processo Node dedicado (worker).
- **Prisma** + PostgreSQL; **BullMQ** + Redis.
- **Vitest** para testes unitários; **Supertest** para API.
- **Zod** em contracts/validation compartilhados.

## Consequências

- Contratos compartilhados evitam drift API/UI.
- Agente Go permanece em `apps/agent` (Fase 2), fora do grafo Turbo de build TS quando necessário.

## Alternativas consideradas

- Turborepo vs Nx: Turborepo por simplicidade no MVP.
- Prisma vs Drizzle: Prisma pelo ecossistema e migrations maduras.
