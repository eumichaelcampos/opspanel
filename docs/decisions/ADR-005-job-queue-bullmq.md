# ADR-005: Filas de jobs com BullMQ

Status: Aceito  
Data: 2026-07-29

## Contexto

Operações demoradas devem ser assíncronas com retries, locks e eventos (PRD FR-JOB-*).

## Decisão

- **BullMQ** sobre Redis para filas `operations`, `notifications` (futuro).
- Estado canônico do job em **PostgreSQL**; Redis apenas transporte.
- Worker atualiza status e append `JobEvent`.

## Consequências

- Redis não é source of truth; perda de Redis exige reconciliação a partir de jobs `running` stale.
