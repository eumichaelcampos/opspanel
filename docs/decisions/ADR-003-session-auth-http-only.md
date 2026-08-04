# ADR-003: Autenticação por sessão em cookie HTTP-only

Status: Aceito  
Data: 2026-07-29

## Contexto

PRD e briefing proíbem tokens em localStorage; exigem sessões seguras e RBAC.

## Decisão

- Sessões persistidas em PostgreSQL (`Session`) com token opaco aleatório.
- Cookie `opspanel_session`: HttpOnly, Secure em produção, SameSite=Lax, path `/`.
- Senhas com **Argon2id**.
- Refresh/rotação de sessão pode ser adicionada antes de MFA.

## Consequências

- CSRF necessário em mutações state-changing quando cookie usado cross-site; SameSite=Lax + origin check na Fase 1.

## Alternativas

- JWT em cookie: rejeitado por rotação e revogação mais simples com sessão server-side.
