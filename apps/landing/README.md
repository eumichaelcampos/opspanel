# OpsPanel Landing

Site comercial e wizard de instalação do OpsPanel. Deploy **separado** do painel (`apps/web`).

## Desenvolvimento

```bash
cp apps/landing/.env.example apps/landing/.env.local
pnpm --filter @opspanel/landing dev
```

- Landing: http://localhost:3002
- Wizard: http://localhost:3002/install

## Variáveis

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_PANEL_URL` | URL pública do painel (ex: `https://panel.seudominio.com`) |
| `NEXT_PUBLIC_GITHUB_REPO` | Repositório exibido nos links GitHub |
| `NEXT_PUBLIC_CONTACT_EMAIL` | E-mail do CTA comercial |

## Produção

```bash
pnpm --filter @opspanel/landing build
pnpm --filter @opspanel/landing start
```

Docker: `infra/docker/Dockerfile.landing`

Em produção típica:

- `opspanel.com` → landing (porta 3002 ou CDN)
- `panel.opspanel.com` → painel (`apps/web`, porta 3000)
- `api.opspanel.com` → API (porta 3001)
