# ADR-002: Execução remota — SSH na Fase 1, agente na Fase 2

Status: Aceito  
Data: 2026-07-29

## Contexto

O PRD recomenda agente local Go com conexão outbound mTLS e evitar senhas SSH permanentes. O briefing de Fase 1 exige cadastro de servidor, credenciais criptografadas e job de teste de conexão SSH real.

## Decisão

Introduzir `RemoteExecutor` em `packages/contracts` com:

1. **Fase 1:** `SshRemoteExecutor` no worker (biblioteca `ssh2`), credenciais descriptografadas apenas em memória no worker, tempo de vida limitado ao job.
2. **Fase 2:** `AgentRemoteExecutor` conforme PRD (mTLS, allowlist no agente).

A API e o frontend **nunca** dependem do transporte; apenas de operation keys tipadas.

## Mitigações de segurança (Fase 1)

- Credenciais criptografadas at rest; nunca logadas.
- Apenas operações allowlisted (`server.connection.test` inicialmente).
- Caminho de migração: servidor pode ser re-registrado via agente; revogação de credencial SSH ao conectar agente.

## Consequências

- Entrega mais rápida do fluxo vertical login → servidor → job.
- Dívida técnica explícita até agente substituir SSH para operações WordOps.
