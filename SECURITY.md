# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a vulnerability

**Do not open public GitHub issues for security vulnerabilities.**

Send details to your security contact (maintainer email or private advisory on GitHub):

1. Description of the issue and impact
2. Steps to reproduce
3. Affected version / commit
4. Suggested fix (optional)

We aim to acknowledge within 72 hours and provide a remediation timeline for confirmed issues.

## Security model

OpsPanel is a **self-hosted control plane** with high privilege over SSH and WordOps on managed servers.

### Implemented controls

- Session cookies: HttpOnly, SameSite=Lax, Secure in production
- Passwords: Argon2id
- SSH credentials: AES-256-GCM envelope encryption at rest
- API keys: SHA-256 hash, prefix `opk_`, revocable
- CORS: restricted to `WEB_URL`
- Helmet security headers
- RBAC: owner, admin, operator, developer, viewer
- Audit log for sensitive operations
- Rate limiting on API (production: 120 req/min)
- Production env rejects default/weak secrets
- Swagger disabled in production

### Operator responsibilities

- Use strong `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`
- Change seed admin password before production
- Terminate TLS at reverse proxy (HTTPS only)
- Restrict network access to API, worker and database
- Rotate API keys and SSH credentials periodically
- Keep WordOps and OS patched on managed servers

### Known limitations (v1.0)

- No MFA/TOTP yet
- No CSRF token (mitigated by SameSite cookies + CORS origin)
- WebSocket terminal accepts session cookie only (not API key)
- Assistant IA rule-based; optional OpenAI via `OPENAI_API_KEY`
