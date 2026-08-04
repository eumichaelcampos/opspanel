export type AccessMode = "ip" | "domain" | "subdomain";
export type ApiLayout = "same-origin" | "api-subdomain" | "direct-ports";
export type ProxyEngine = "nginx" | "caddy" | "none";

export type InstallDraft = {
  accessMode: AccessMode;
  serverIp: string;
  domain: string;
  subdomain: string;
  webPort: number;
  apiPort: number;
  useHttps: boolean;
  apiLayout: ApiLayout;
  apiSubdomainPrefix: string;
  databaseUrl: string;
  redisUrl: string;
  sessionSecret: string;
  encryptionKey: string;
  adminEmail: string;
  adminPassword: string;
  githubRepo: string;
  proxyEngine: ProxyEngine;
};

export type InstallArtifacts = {
  webUrl: string;
  apiUrl: string;
  publicApiUrl: string;
  envRoot: string;
  envWeb: string;
  nginxConfig: string | null;
  caddyConfig: string | null;
  installCommands: string;
  dnsRecords: { type: string; name: string; value: string; note?: string }[];
  notes: string[];
};

export const INSTALL_STEPS = [
  { id: "welcome", label: "Início" },
  { id: "access", label: "Acesso" },
  { id: "address", label: "Endereço" },
  { id: "api", label: "API & HTTPS" },
  { id: "secrets", label: "Segurança" },
  { id: "review", label: "Resumo" },
] as const;

export type InstallStepId = (typeof INSTALL_STEPS)[number]["id"];

export function defaultInstallDraft(): InstallDraft {
  return {
    accessMode: "domain",
    serverIp: "",
    domain: "",
    subdomain: "ops",
    webPort: 3000,
    apiPort: 3001,
    useHttps: true,
    apiLayout: "same-origin",
    apiSubdomainPrefix: "api",
    databaseUrl: "postgresql://opspanel:opspanel@localhost:5432/opspanel",
    redisUrl: "redis://localhost:6379",
    sessionSecret: "",
    encryptionKey: "",
    adminEmail: "admin@seudominio.com",
    adminPassword: "",
    githubRepo: process.env.NEXT_PUBLIC_GITHUB_REPO ?? "your-org/opspanel",
    proxyEngine: "nginx",
  };
}

function hostFromDraft(d: InstallDraft): string {
  if (d.accessMode === "ip") return d.serverIp.trim();
  if (d.accessMode === "subdomain") {
    const sub = d.subdomain.trim() || "ops";
    const dom = d.domain.trim();
    return dom ? `${sub}.${dom}` : sub;
  }
  return d.domain.trim();
}

function scheme(d: InstallDraft): "http" | "https" {
  if (d.accessMode === "ip" && !d.useHttps) return "http";
  if (d.accessMode === "domain" || d.accessMode === "subdomain") return d.useHttps ? "https" : "http";
  return d.useHttps ? "https" : "http";
}

export function generateRandomSecret(length = 32): string {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    return `change-me-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildInstallArtifacts(d: InstallDraft): InstallArtifacts {
  const host = hostFromDraft(d);
  const sch = scheme(d);
  const notes: string[] = [];
  const dnsRecords: InstallArtifacts["dnsRecords"] = [];

  let webUrl: string;
  let apiUrl: string;
  let publicApiUrl: string;

  if (d.accessMode === "ip") {
    webUrl = `${sch}://${host}:${d.webPort}`;
    if (d.apiLayout === "direct-ports") {
      apiUrl = `${sch}://${host}:${d.apiPort}`;
      publicApiUrl = apiUrl;
      notes.push("Com IP e portas expostas, libere 3000 e 3001 no firewall (UFW/security group).");
      notes.push("WebSocket do terminal SSH usa a porta da API diretamente.");
    } else {
      apiUrl = `http://127.0.0.1:${d.apiPort}`;
      publicApiUrl = webUrl;
      notes.push("Recomendado: use Nginx na porta 80/443 e mantenha Node apenas em localhost.");
    }
    dnsRecords.push({ type: "A", name: "@ ou host", value: host, note: "Aponte o IP público da VPS" });
  } else {
    webUrl = `${sch}://${host}`;
    dnsRecords.push({
      type: "A",
      name: d.accessMode === "subdomain" ? d.subdomain || "ops" : "@",
      value: d.serverIp.trim() || "SEU_IP_PUBLICO",
      note: "Registro DNS apontando para a VPS",
    });

    if (d.apiLayout === "api-subdomain") {
      const apiHost = `${d.apiSubdomainPrefix.trim() || "api"}.${d.domain.trim()}`;
      publicApiUrl = `${sch}://${apiHost}`;
      apiUrl = publicApiUrl;
      dnsRecords.push({ type: "A", name: d.apiSubdomainPrefix || "api", value: d.serverIp.trim() || "SEU_IP_PUBLICO" });
      notes.push("Configure CORS: WEB_URL deve bater com o domínio do painel.");
      notes.push("Defina NEXT_PUBLIC_API_URL no apps/web/.env.local para o subdomínio da API.");
    } else {
      apiUrl = d.apiLayout === "same-origin" ? `http://127.0.0.1:${d.apiPort}` : webUrl;
      publicApiUrl = d.apiLayout === "same-origin" ? webUrl : `${sch}://${host}:${d.apiPort}`;
      notes.push("Modo same-origin: Next.js faz proxy de /api/v1 para a API interna.");
      notes.push("Nginx deve repassar WebSocket em /api/v1/servers/*/terminal.");
    }
  }

  const envRoot = `# OpsPanel — gerado pelo wizard de instalação
NODE_ENV=production

DATABASE_URL=${d.databaseUrl}
REDIS_URL=${d.redisUrl}

API_PORT=${d.apiPort}
API_URL=${apiUrl}
WEB_URL=${webUrl}

SESSION_SECRET=${d.sessionSecret || "SUBSTITUA_GERE_NO_WIZARD"}
CREDENTIALS_ENCRYPTION_KEY=${d.encryptionKey || "SUBSTITUA_GERE_NO_WIZARD"}

SEED_ADMIN_EMAIL=${d.adminEmail}
SEED_ADMIN_PASSWORD=${d.adminPassword || "SUBSTITUA_SENHA_FORTE"}
`;

  const envWeb =
    d.apiLayout === "api-subdomain"
      ? `# apps/web/.env.local
API_URL=${apiUrl}
NEXT_PUBLIC_API_URL=${publicApiUrl}
NEXT_PUBLIC_GITHUB_REPO=${d.githubRepo}
`
      : `# apps/web/.env.local
API_URL=http://127.0.0.1:${d.apiPort}
NEXT_PUBLIC_GITHUB_REPO=${d.githubRepo}
`;

  const nginxConfig =
    d.accessMode !== "ip" || d.apiLayout !== "direct-ports"
      ? buildNginxConfig(d, host, webUrl)
      : d.useHttps
        ? buildNginxConfig(d, host, webUrl)
        : null;

  const caddyConfig =
    d.proxyEngine === "caddy" && (d.accessMode !== "ip" || d.useHttps)
      ? buildCaddyConfig(d, host)
      : null;

  const githubUrl = `https://github.com/${d.githubRepo}.git`;
  const installCommands = `# 1. Clonar
git clone ${githubUrl}
cd opspanel

# 2. Configurar (cole os arquivos gerados abaixo)
cp .env.example .env
# edite .env com o conteúdo gerado

mkdir -p apps/web
cp apps/web/.env.example apps/web/.env.local
# edite apps/web/.env.local

# 3. Infra
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Instalar
chmod +x scripts/install.sh
./scripts/install.sh

# 5. Proxy reverso (se domínio)
# sudo cp opspanel.conf /etc/nginx/sites-available/
# sudo ln -s /etc/nginx/sites-available/opspanel.conf /etc/nginx/sites-enabled/
# sudo certbot --nginx -d ${host}${d.apiLayout === "api-subdomain" ? ` -d ${d.apiSubdomainPrefix}.${d.domain}` : ""}

# 6. Produção
NODE_ENV=production pnpm --filter @opspanel/api start &
NODE_ENV=production pnpm --filter @opspanel/worker start &
NODE_ENV=production pnpm --filter @opspanel/web start
`;

  if (d.useHttps && d.accessMode !== "ip") {
    notes.push("Use Certbot ou Caddy automatic HTTPS após apontar o DNS.");
  }

  return { webUrl, apiUrl, publicApiUrl, envRoot, envWeb, nginxConfig, caddyConfig, installCommands, dnsRecords, notes };
}

function buildNginxConfig(d: InstallDraft, host: string, webUrl: string): string {
  const apiHost =
    d.apiLayout === "api-subdomain" ? `${d.apiSubdomainPrefix.trim() || "api"}.${d.domain.trim()}` : null;
  const listen = d.useHttps ? "443 ssl http2" : "80";
  const sslBlock = d.useHttps
    ? `
    ssl_certificate     /etc/letsencrypt/live/${host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
`
    : "";

  const panelBlock = `
server {
    listen ${listen};
    server_name ${host};${sslBlock}

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:${d.webPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/v1/ {
        proxy_pass http://127.0.0.1:${d.apiPort}/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Console SSH (WebSocket)
    location ~ ^/api/v1/servers/[^/]+/terminal$ {
        proxy_pass http://127.0.0.1:${d.apiPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
`;

  if (!apiHost) return panelBlock.trim();

  return `${panelBlock}
server {
    listen ${listen};
    server_name ${apiHost};${sslBlock.replaceAll(host, apiHost)}

    location / {
        proxy_pass http://127.0.0.1:${d.apiPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/api/v1/servers/[^/]+/terminal$ {
        proxy_pass http://127.0.0.1:${d.apiPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
`.trim();
}

function buildCaddyConfig(d: InstallDraft, host: string): string {
  const apiHost =
    d.apiLayout === "api-subdomain" ? `${d.apiSubdomainPrefix.trim() || "api"}.${d.domain.trim()}` : null;

  if (apiHost) {
    return `${host} {
    reverse_proxy 127.0.0.1:${d.webPort}
}

${apiHost} {
    reverse_proxy 127.0.0.1:${d.apiPort}
}`.trim();
  }

  return `${host} {
    reverse_proxy 127.0.0.1:${d.webPort}

    handle /api/v1/* {
        reverse_proxy 127.0.0.1:${d.apiPort}
    }
}`.trim();
}

export function validateStep(step: InstallStepId, d: InstallDraft): string | null {
  switch (step) {
    case "access":
      return null;
    case "address": {
      if (d.accessMode === "ip" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(d.serverIp.trim())) {
        return "Informe um IPv4 válido para o servidor.";
      }
      if (d.accessMode !== "ip" && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.domain.trim())) {
        return "Informe um domínio válido (ex: exemplo.com.br).";
      }
      if (d.accessMode === "subdomain" && !/^[a-z0-9-]+$/i.test(d.subdomain.trim())) {
        return "Subdomínio inválido (use letras, números e hífen).";
      }
      if (d.accessMode !== "ip" && !d.serverIp.trim()) {
        return "Informe o IP público da VPS para gerar registros DNS.";
      }
      return null;
    }
    case "secrets": {
      if (!/^[^\s@]+@[^\s@]+$/.test(d.adminEmail)) return "E-mail admin inválido.";
      if (d.adminPassword.length < 8) return "Senha admin deve ter no mínimo 8 caracteres.";
      if (d.sessionSecret.length < 32) return "Gere ou informe SESSION_SECRET (mín. 32 caracteres).";
      if (d.encryptionKey.length < 32) return "Gere ou informe CREDENTIALS_ENCRYPTION_KEY.";
      return null;
    }
    default:
      return null;
  }
}
