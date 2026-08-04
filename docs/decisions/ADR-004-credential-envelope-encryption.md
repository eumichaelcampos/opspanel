# ADR-004: Criptografia de credenciais de servidor

Status: Aceito  
Data: 2026-07-29

## Contexto

Servidores exigem chave SSH ou senha; PRD exige envelope encryption e nunca texto puro em repouso.

## Decisão

- **Fase 1:** AES-256-GCM com chave mestra `CREDENTIALS_ENCRYPTION_KEY` (32 bytes base64) derivada/configurada por ambiente.
- Payload JSON `{ type, username, privateKey?, password? }` serializado e cifrado; armazenar `ciphertext` + `iv` + `keyVersion`.
- API retorna apenas `credentialConfigured: true` e tipo; substituição exige novo payload, sem reveal.

## Evolução

- Integrar KMS/Vault (PRD) em produção; rotação por `keyVersion`.

## Consequências

- Comprometimento da chave mestra expõe credenciais; secret manager obrigatório em produção.
