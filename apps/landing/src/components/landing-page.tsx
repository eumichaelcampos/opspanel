import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Cloud,
  Download,
  GitBranch,
  Globe,
  Hexagon,
  Layers,
  Lock,
  Server,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";
import { panelUrl } from "@/lib/panel-url";

const VERSION = "1.0.0";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "your-org/opspanel";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

const FEATURES = [
  {
    icon: Server,
    title: "Multi-servidor WordOps",
    desc: "Cadastre VPS Linux, valide SSH e gerencie toda a stack WordOps a partir de um painel central.",
  },
  {
    icon: Globe,
    title: "Sites e SSL",
    desc: "Crie sites HTML, PHP, MySQL e WordPress com Let's Encrypt, cache e Cloudflare DNS.",
  },
  {
    icon: Layers,
    title: "Stack completa",
    desc: "Nginx, PHP-FPM, MariaDB, Redis, Netdata, Fail2ban e ProFTPd com um clique ou comando wo.",
  },
  {
    icon: Terminal,
    title: "Console e arquivos",
    desc: "Terminal SSH web no onboarding, gerenciador SFTP por site e jobs com log em tempo real.",
  },
  {
    icon: Bot,
    title: "Assistente IA + MCP",
    desc: "Crie sites conversando com a IA ou controle tudo via MCP no Cursor e Claude Desktop.",
  },
  {
    icon: Shield,
    title: "Segurança enterprise",
    desc: "Sessões HttpOnly, credenciais SSH criptografadas, RBAC, auditoria e API keys com hash.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Hexagon className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <span className="font-semibold text-ink">OpsPanel</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#recursos" className="hover:text-ink">Recursos</a>
            <a href="#comercial" className="hover:text-ink">Comercial</a>
            <a href="#wordops" className="hover:text-ink">WordOps</a>
            <a href="/install" className="hover:text-ink">Instalar</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm text-muted hover:text-ink sm:inline-flex"
            >
              GitHub
            </Link>
            <Link
              href={panelUrl("/login")}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-95"
            >
              Acessar painel
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              <Zap className="h-3.5 w-3.5" />
              Control plane WordOps · v{VERSION}
            </span>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
              Gerencie servidores WordOps com a interface que faltava
            </h1>
            <p className="max-w-xl text-lg text-muted">
              OpsPanel é a plataforma open source para provisionar VPS, instalar WordOps, criar sites WordPress,
              monitorar recursos e operar tudo com jobs assíncronos, auditoria e IA integrada.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/install"
                className="inline-flex items-center gap-2 rounded-card bg-accent px-5 py-3 text-sm font-medium text-white shadow-sm hover:opacity-95"
              >
                <Download className="h-4 w-4" />
                Assistente de instalação
              </Link>
              <Link
                href={panelUrl("/login")}
                className="inline-flex items-center gap-2 rounded-card border border-white/80 bg-white/80 px-5 py-3 text-sm font-medium text-ink hover:bg-white"
              >
                Entrar no painel
              </Link>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Credenciais criptografadas</span>
              <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> Monorepo TypeScript</span>
              <span className="inline-flex items-center gap-1"><Cloud className="h-3.5 w-3.5" /> Self-hosted</span>
            </div>
          </div>

          <div className="glass-panel relative overflow-hidden p-6 lg:p-8">
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
            <div className="relative space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Preview do painel</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Servidores", value: "12", sub: "10 saudáveis" },
                  { label: "Sites", value: "847", sub: "WordPress + PHP" },
                  { label: "Jobs", value: "3", sub: "em execução" },
                  { label: "Stack", value: "WO 3.22", sub: "Netdata ativo" },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-card border border-white/70 bg-white/70 p-4">
                    <p className="text-xs text-muted">{kpi.label}</p>
                    <p className="text-2xl font-semibold text-ink">{kpi.value}</p>
                    <p className="text-[10px] text-muted">{kpi.sub}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-card border border-white/70 bg-white/60 p-4 font-mono text-[11px] text-ink/80">
                <p className="text-success">✓ wo site create exemplo.com.br --wp</p>
                <p className="text-muted">→ Job #a3f2… provisionando nginx + php + mysql</p>
                <p className="text-accent">→ SSL Let's Encrypt solicitado</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="recursos" className="border-t border-white/50 bg-white/30 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold text-ink">Tudo que você precisa para operar WordOps em escala</h2>
            <p className="mt-3 text-muted">
              Do onboarding de servidor virgem à gestão de centenas de sites, com a mesma experiência visual e jobs rastreáveis.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <article key={title} className="glass-card p-5 transition hover:shadow-lg">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-sm text-muted">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="wordops" className="py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div className="space-y-5">
            <h2 className="text-3xl font-bold text-ink">Construído em cima do WordOps</h2>
            <p className="text-muted">
              WordOps é a stack de referência para Nginx, PHP, MariaDB e WordPress em servidores Linux.
              OpsPanel não substitui o WordOps: ele orquestra cada comando <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs">wo</code> com
              filas, permissões e interface visual.
            </p>
            <ul className="space-y-3 text-sm text-muted">
              <li className="flex gap-2"><span className="text-accent">•</span> Wizard de provisionamento: apt update → wo install → stack web → Netdata</li>
              <li className="flex gap-2"><span className="text-accent">•</span> Criação de sites: HTML, PHP, MySQL, WP, WP Rocket, proxy e alias</li>
              <li className="flex gap-2"><span className="text-accent">•</span> Dashboard :22222 integrado: phpMyAdmin, Netdata, Redis, PHP-FPM status</li>
              <li className="flex gap-2"><span className="text-accent">•</span> Métricas Netdata: CPU, Nginx, Network IN/OUT e alarmes em tempo real</li>
            </ul>
            <a
              href="https://wordops.net"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Documentação WordOps
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="glass-card-dark space-y-3 p-6 font-mono text-sm">
            <p className="text-white/50"># OpsPanel executa via worker SSH</p>
            <p><span className="text-accent">wo</span> stack install --web</p>
            <p><span className="text-accent">wo</span> site create meusite.com.br --wp --letsencrypt</p>
            <p><span className="text-accent">wo</span> site info meusite.com.br</p>
            <p><span className="text-accent">wo</span> stack status</p>
            <p className="pt-2 text-white/50"># Resultado: job auditável + UI atualizada</p>
          </div>
        </div>
      </section>

      <section id="comercial" className="border-t border-white/50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-bold text-ink">Open source, pronto para uso comercial</h2>
            <p className="mt-3 text-muted">
              O OpsPanel é self-hosted e gratuito para instalar na sua infra. Esta landing é o site comercial;
              o painel roda separado no seu domínio ou VPS.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <article className="glass-card p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Community</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Self-hosted</h3>
              <p className="mt-2 text-sm text-muted">
                Código aberto (MIT), wizard de instalação, documentação e suporte da comunidade via GitHub.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-muted">
                <li>• Multi-servidor WordOps ilimitado</li>
                <li>• Assistente IA e MCP server</li>
                <li>• Deploy na sua VPS ou cloud</li>
              </ul>
              <Link
                href="/install"
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                Começar instalação
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
            <article className="glass-card-dark p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Enterprise</p>
              <h3 className="mt-2 text-xl font-semibold">Suporte e implementação</h3>
              <p className="mt-2 text-sm text-white/70">
                Para agências, hosts e equipes que precisam de onboarding, SLA, customizações ou operação gerenciada.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-white/70">
                <li>• Implantação em produção com HTTPS</li>
                <li>• Treinamento e integração MCP/IA</li>
                <li>• Roadmap prioritário e consultoria WordOps</li>
              </ul>
              {CONTACT_EMAIL ? (
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=OpsPanel%20comercial`}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                >
                  Falar com vendas
                  <ArrowRight className="h-4 w-4" />
                </a>
              ) : (
                <p className="mt-5 text-sm text-white/50">Defina NEXT_PUBLIC_CONTACT_EMAIL para exibir contato.</p>
              )}
            </article>
          </div>
        </div>
      </section>

      <section id="instalar" className="border-t border-white/50 bg-white/30 py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-bold text-ink">Pronto para instalar?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">
            Use o assistente interativo para escolher IP, domínio ou subdomínio, gerar arquivos{" "}
            <code className="text-xs">.env</code>, configuração Nginx/Caddy e comandos personalizados.
          </p>
          <Link
            href="/install"
            className="mt-6 inline-flex items-center gap-2 rounded-card bg-accent px-6 py-3 text-sm font-medium text-white hover:opacity-95"
          >
            Abrir wizard de instalação
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-4 text-xs text-muted">v{VERSION} · Também disponível download ZIP no GitHub</p>
        </div>
      </section>

      <footer className="border-t border-white/50 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-muted">
          <p>OpsPanel v{VERSION} · Control plane WordOps open source</p>
          <div className="flex gap-4">
            <Link href={panelUrl("/login")} className="hover:text-ink">Login</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
            <a href="https://wordops.net" target="_blank" rel="noreferrer" className="hover:text-ink">WordOps</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
