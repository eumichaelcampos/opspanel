# ADR-006: Operações tipadas e allowlist

Status: Aceito  
Data: 2026-07-29

## Contexto

Princípio inegociável: nenhum comando shell arbitrário do frontend.

## Decisão

- Operation keys estáveis (`server.connection.test`, `server.wordops.install`, …) definidas em `packages/contracts`.
- Cada key mapeia para handler no worker + adapter wordops + política RBAC.
- Entrada validada por Zod; idempotency key em POSTs operacionais (Fase 2 completa).

## Consequências

- Novas capacidades exigem novo schema + handler + testes, nunca endpoint genérico `exec`.
