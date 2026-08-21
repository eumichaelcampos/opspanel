import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OperationKeys,
  collectOpenAlerts,
  computeSecurityScore,
  resolveSiteInventory,
  type SecurityCheck,
  type SecurityHubResponse,
  type SecurityScanSnapshot,
  type SecurityScore,
  type ServerHealthSnapshot,
  type ServerSecurityReport,
  type SiteInfoSnapshot,
  type SiteSecurityReport,
  type StackComponentState,
  type WpSiteInventory,
} from "@opspanel/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/auth.guard";
import { JobsService } from "../jobs/jobs.service";
import { lookupWpVulnerabilities, type WpVulnHit } from "./wpvulnerability.client";

function canManage(user: SessionUser) {
  return user.role === "owner" || user.role === "admin" || user.role === "operator";
}

function componentMap(components?: StackComponentState[]) {
  const map = new Map<string, StackComponentState>();
  for (const c of components ?? []) map.set(c.id, c);
  return map;
}

function isFresh(iso?: string | null, maxMs = 6 * 60 * 60 * 1000): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxMs;
}

function phpSupported(version?: string | null): SecurityCheck["severity"] {
  if (!version) return "unknown";
  const major = Number(version.split(".")[0]);
  const minor = Number(version.split(".")[1] ?? "0");
  if (!Number.isFinite(major)) return "unknown";
  if (major < 8) return "critical";
  if (major === 8 && minor < 1) return "warning";
  return "ok";
}

function pluginSlug(name: string): string {
  const base = name.includes("/") ? name.split("/")[0]! : name;
  return base.replace(/\.php$/i, "").trim();
}

function vulnSeverityToCheck(sev: WpVulnHit["severity"]): SecurityCheck["severity"] {
  if (sev === "critical" || sev === "high") return "critical";
  if (sev === "medium" || sev === "low") return "warning";
  return "warning";
}

function buildServerChecks(input: {
  health?: ServerHealthSnapshot | null;
  healthAt?: string | null;
  scan?: SecurityScanSnapshot | null;
  scanAt?: string | null;
  serverStatus: string;
  serverId: string;
}): SecurityCheck[] {
  const comps = componentMap(input.health?.stackComponents);
  const fail2ban = comps.get("fail2ban");
  const ufw = comps.get("ufw");
  const ngx = comps.get("ngxblocker");
  const scan = input.scan;

  const checks: SecurityCheck[] = [];

  checks.push({
    id: "health_fresh",
    label: "Dados de saúde atualizados",
    severity: isFresh(input.healthAt) ? "ok" : "warning",
    detail: input.healthAt
      ? `Última coleta: ${new Date(input.healthAt).toLocaleString("pt-BR")}`
      : "Nenhuma coleta de saúde ainda",
    actionHint: "Atualizar saúde",
    href: `/servers/${input.serverId}`,
  });

  if (fail2ban) {
    checks.push({
      id: "fail2ban",
      label: "Fail2ban",
      severity: fail2ban.running ? "ok" : fail2ban.installed ? "warning" : "critical",
      detail: fail2ban.running
        ? scan?.fail2banJails?.length
          ? `Ativo · ${scan.fail2banJails.length} jail(s) · ${scan.fail2banBannedTotal ?? 0} banidos`
          : "Instalado e em execução"
        : fail2ban.installed
          ? "Instalado, mas parado"
          : "Não instalado",
      actionHint: fail2ban.running ? undefined : "Instalar stack de segurança",
      href: `/servers/${input.serverId}?tab=stack`,
    });
  } else {
    checks.push({
      id: "fail2ban",
      label: "Fail2ban",
      severity: "critical",
      detail: "Componente não detectado no inventário",
      actionHint: "Instalar stack de segurança",
      href: `/servers/${input.serverId}?tab=stack`,
    });
  }

  const ufwActive = scan?.ufwActive ?? ufw?.running;
  checks.push({
    id: "ufw",
    label: "Firewall UFW",
    severity: ufwActive ? "ok" : ufw?.installed ? "warning" : "critical",
    detail: ufwActive
      ? `Ativo${scan?.ufwOpenPorts?.length ? ` · portas: ${scan.ufwOpenPorts.join(", ")}` : ""}`
      : ufw?.installed
        ? "Instalado, mas inativo"
        : "Não configurado",
    actionHint: ufwActive ? undefined : "Configurar UFW",
    href: `/servers/${input.serverId}?tab=stack`,
  });

  checks.push({
    id: "ngxblocker",
    label: "Nginx Bad Bot Blocker",
    severity: ngx?.installed ? "ok" : "warning",
    detail: ngx?.installed ? "Disponível no stack" : "Não instalado no servidor",
    actionHint: ngx?.installed ? undefined : "Instalar ngxblocker",
    href: `/servers/${input.serverId}?tab=stack`,
  });

  if (scan?.listeningTcpPorts?.length) {
    const risky = scan.listeningTcpPorts.filter(
      (p) => ![22, 80, 443, 22222, 3306, 6379, 19999].includes(p) && p < 1024,
    );
    checks.push({
      id: "listening_ports",
      label: "Portas TCP em escuta",
      severity: risky.length ? "warning" : "ok",
      detail: `${scan.listeningTcpPorts.slice(0, 12).join(", ")}${scan.listeningTcpPorts.length > 12 ? "…" : ""}`,
    });
  }

  if (scan?.permitRootLogin) {
    const pr = scan.permitRootLogin.toLowerCase();
    const ok = pr === "no" || pr === "prohibit-password" || pr === "without-password";
    checks.push({
      id: "root_login",
      label: "Login root SSH",
      severity: ok ? "ok" : pr === "unknown" ? "unknown" : "warning",
      detail: `PermitRootLogin=${scan.permitRootLogin}`,
    });
  }

  if (scan) {
    if (scan.lynisInstalled) {
      const idx = scan.lynisHardeningIndex;
      checks.push({
        id: "lynis",
        label: "Lynis (auditoria)",
        severity: idx == null ? "unknown" : idx >= 70 ? "ok" : idx >= 50 ? "warning" : "critical",
        detail:
          idx != null
            ? `Índice de hardening ${idx}/100 · ${scan.lynisWarnings ?? 0} avisos · ${scan.lynisSuggestions ?? 0} sugestões`
            : "Instalado, mas sem relatório recente (rode: lynis audit system)",
        actionHint: idx == null || idx < 70 ? "Rodar lynis audit system no servidor" : undefined,
        href: `/servers/${input.serverId}`,
      });
    } else if (isFresh(input.scanAt)) {
      checks.push({
        id: "lynis",
        label: "Lynis (auditoria)",
        severity: "warning",
        detail: "Não instalado. Pacote gratuito: apt install lynis",
        actionHint: "Instalar Lynis",
        href: `/servers/${input.serverId}`,
      });
    }

    if (isFresh(input.scanAt) || scan.clamavInstalled) {
      checks.push({
        id: "clamav",
        label: "ClamAV (antimalware)",
        severity: scan.clamavInstalled ? (scan.clamavFresh ? "ok" : "warning") : "warning",
        detail: scan.clamavInstalled
          ? scan.clamavFresh
            ? `Instalado · freshclam ativo${scan.clamavLastScanAt ? ` · log ${new Date(scan.clamavLastScanAt).toLocaleString("pt-BR")}` : ""}`
            : "Instalado, mas freshclam parado (assinaturas podem estar velhas)"
          : "Não instalado. apt install clamav clamav-daemon",
        actionHint: scan.clamavInstalled ? undefined : "Instalar ClamAV",
        href: `/servers/${input.serverId}`,
      });
    }

    if (isFresh(input.scanAt) || scan.chkrootkitInstalled || scan.rkhunterInstalled) {
      const hasRootkit = Boolean(scan.chkrootkitInstalled || scan.rkhunterInstalled);
      const parts = [
        scan.chkrootkitInstalled ? "chkrootkit" : null,
        scan.rkhunterInstalled ? "rkhunter" : null,
      ].filter(Boolean);
      checks.push({
        id: "rootkit_scanners",
        label: "Detecção de rootkit",
        severity: hasRootkit ? "ok" : "warning",
        detail: hasRootkit
          ? `Disponível: ${parts.join(", ")}`
          : "Nenhum. apt install chkrootkit rkhunter",
        actionHint: hasRootkit ? undefined : "Instalar scanners",
        href: `/servers/${input.serverId}`,
      });
    }

    if (isFresh(input.scanAt) || scan.crowdsecInstalled) {
      checks.push({
        id: "crowdsec",
        label: "CrowdSec (IPS)",
        severity: scan.crowdsecInstalled
          ? scan.crowdsecRunning
            ? "ok"
            : "warning"
          : "warning",
        detail: scan.crowdsecInstalled
          ? scan.crowdsecRunning
            ? "Instalado e em execução (tier free)"
            : "Instalado, mas serviço parado"
          : "Não instalado. Ver https://docs.crowdsec.net (gratuito)",
        actionHint: scan.crowdsecRunning ? undefined : "Ativar CrowdSec",
        href: `/servers/${input.serverId}`,
      });
    }

    if (isFresh(input.scanAt) || scan.unattendedUpgradesEnabled !== undefined) {
      checks.push({
        id: "unattended_upgrades",
        label: "Atualizações automáticas (SO)",
        severity: scan.unattendedUpgradesEnabled ? "ok" : "warning",
        detail: scan.unattendedUpgradesEnabled
          ? "unattended-upgrades ativo"
          : "Desativado. apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades",
        actionHint: scan.unattendedUpgradesEnabled ? undefined : "Ativar patches automáticos",
        href: `/servers/${input.serverId}`,
      });
    }

    if (isFresh(input.scanAt) || scan.aideInstalled) {
      checks.push({
        id: "aide",
        label: "AIDE (integridade de arquivos)",
        severity: scan.aideInstalled ? (scan.aideDbExists ? "ok" : "warning") : "warning",
        detail: scan.aideInstalled
          ? scan.aideDbExists
            ? "Instalado com base de dados"
            : "Instalado, mas sem DB (rode aideinit)"
          : "Não instalado. apt install aide",
        actionHint: scan.aideInstalled && scan.aideDbExists ? undefined : "Configurar AIDE",
        href: `/servers/${input.serverId}`,
      });
    }
  }

  if (input.serverStatus === "offline" || input.serverStatus === "critical") {
    checks.push({
      id: "server_status",
      label: "Status do servidor",
      severity: "critical",
      detail: `Servidor marcado como ${input.serverStatus}`,
      href: `/servers/${input.serverId}`,
    });
  }

  return checks;
}

function buildSiteChecks(input: {
  siteId: string;
  serverId: string;
  info?: SiteInfoSnapshot | null;
  wpInventory?: WpSiteInventory | null;
  vulns?: WpVulnHit[];
}): SecurityCheck[] {
  const inv = resolveSiteInventory(input.info);
  const checks: SecurityCheck[] = [];

  if (inv.needsRefresh) {
    checks.push({
      id: "site_info",
      label: "Inventário do site",
      severity: "warning",
      detail: "Atualize as informações do site para avaliar segurança",
      actionHint: "Atualizar info",
      href: `/sites/${input.siteId}`,
    });
    return checks;
  }

  for (const item of [...inv.active, ...inv.inactive].filter(
    (i) => i.category === "security" || i.id === "enabled" || i.id === "php",
  )) {
    if (item.id === "ssl") {
      checks.push({
        id: "ssl",
        label: "SSL / HTTPS",
        severity: item.active ? "ok" : "critical",
        detail: item.detail,
        actionHint: item.active ? undefined : "Ativar Let's Encrypt",
        href: `/sites/${input.siteId}?tab=manage`,
      });
    } else if (item.id === "hsts") {
      checks.push({
        id: "hsts",
        label: "HSTS",
        severity: item.active ? "ok" : "warning",
        detail: item.active ? "Ativo" : "Desativado",
        href: `/sites/${input.siteId}?tab=manage`,
      });
    } else if (item.id === "ngxblocker") {
      checks.push({
        id: "site_ngxblocker",
        label: "Bot blocker no site",
        severity: item.active ? "ok" : "warning",
        detail: item.active ? "Ativo neste vhost" : "Não habilitado neste site",
        href: `/sites/${input.siteId}`,
      });
    } else if (item.id === "enabled") {
      checks.push({
        id: "site_enabled",
        label: "Site ativo",
        severity: item.active ? "ok" : "warning",
        detail: item.detail,
      });
    } else if (item.id === "php") {
      const ver = input.info?.phpVersion;
      checks.push({
        id: "php_supported",
        label: ver ? `PHP ${ver}` : "PHP",
        severity: phpSupported(ver),
        detail: phpSupported(ver) === "critical" ? "Versão antiga, atualize" : undefined,
        href: `/sites/${input.siteId}?tab=manage`,
      });
    }
  }

  const wp = input.wpInventory;
  if (wp) {
    const updates =
      (wp.coreUpdateAvailable ? 1 : 0) + (wp.pluginUpdates ?? 0) + (wp.themeUpdates ?? 0);
    checks.push({
      id: "wp_updates",
      label: "Atualizações WordPress",
      severity: updates === 0 ? "ok" : wp.coreUpdateAvailable ? "critical" : "warning",
      detail:
        updates === 0
          ? "Core, plugins e temas atualizados"
          : `${updates} atualização(ões) pendente(s)${wp.coreUpdateAvailable ? " (inclui core)" : ""}`,
      actionHint: updates ? "Atualizar no Centro WP" : undefined,
      href: `/wordpress`,
    });
  }

  const vulns = input.vulns ?? [];
  if (vulns.length) {
    const criticalCount = vulns.filter((v) => v.severity === "critical" || v.severity === "high").length;
    const bySlug = new Map<string, WpVulnHit[]>();
    for (const v of vulns) {
      const key = `${v.kind}:${v.slug}`;
      const list = bySlug.get(key) ?? [];
      list.push(v);
      bySlug.set(key, list);
    }
    const top = [...bySlug.entries()].slice(0, 5).map(([key, hits]) => {
      const first = hits[0]!;
      return `${first.slug} (${hits.length} CVE${hits.length > 1 ? "s" : ""})`;
    });
    checks.push({
      id: "wp_vulns",
      label: "Vulnerabilidades conhecidas (WPVulnerability)",
      severity: criticalCount ? "critical" : "warning",
      detail: `${vulns.length} achado(s) em ${bySlug.size} componente(s): ${top.join("; ")}${bySlug.size > 5 ? "…" : ""}`,
      actionHint: "Atualizar plugins/temas vulneráveis",
      href: `/sites/${input.siteId}?tab=manage`,
    });
    let i = 0;
    for (const [, hits] of bySlug) {
      if (i >= 5) break;
      const v = hits.sort((a, b) => {
        const rank = (s: WpVulnHit["severity"]) =>
          s === "critical" ? 0 : s === "high" ? 1 : s === "medium" ? 2 : 3;
        return rank(a.severity) - rank(b.severity);
      })[0]!;
      checks.push({
        id: `wp_vuln_${v.kind}_${v.slug}_${i}`,
        label: `${v.kind === "core" ? "Core" : v.kind === "theme" ? "Tema" : "Plugin"}: ${v.slug}`,
        severity: vulnSeverityToCheck(v.severity),
        detail: `${hits.length} CVE(s) · ${v.title}${v.fixedIn ? ` · corrigido em ${v.fixedIn}+` : ""}${v.installedVersion ? ` · instalado ${v.installedVersion}` : ""}`,
        href: v.link ?? `/wordpress`,
        actionHint: "Ver CVE / atualizar",
      });
      i += 1;
    }
  } else if (wp && !wp.error) {
    checks.push({
      id: "wp_vulns",
      label: "Vulnerabilidades conhecidas (WPVulnerability)",
      severity: "ok",
      detail: "Nenhuma CVE ativa para as versões inventariadas (API gratuita)",
      href: `/wordpress`,
    });
  }

  return checks;
}

function mergeScores(scores: SecurityScore[]): SecurityScore {
  const checks: SecurityCheck[] = [];
  for (const s of scores) {
    for (let i = 0; i < s.ok; i++) checks.push({ id: `ok-${i}`, label: "", severity: "ok" });
    for (let i = 0; i < s.warning; i++) checks.push({ id: `w-${i}`, label: "", severity: "warning" });
    for (let i = 0; i < s.critical; i++) checks.push({ id: `c-${i}`, label: "", severity: "critical" });
    for (let i = 0; i < s.unknown; i++) checks.push({ id: `u-${i}`, label: "", severity: "unknown" });
  }
  return computeSecurityScore(checks);
}

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  private async requireServer(user: SessionUser, serverId: string) {
    const server = await this.prisma.client.server.findFirst({
      where: { id: serverId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!server) throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Servidor não encontrado." } });
    return server;
  }

  buildServerReport(server: {
    id: string;
    name: string;
    host: string;
    status: string;
    healthSnapshot: unknown;
    healthObservedAt: Date | null;
    securitySnapshot: unknown;
    securityObservedAt: Date | null;
  }): ServerSecurityReport {
    const health = server.healthSnapshot as ServerHealthSnapshot | null;
    const scan = server.securitySnapshot as SecurityScanSnapshot | null;
    const comps = componentMap(health?.stackComponents);
    const checks = buildServerChecks({
      health,
      healthAt: server.healthObservedAt?.toISOString() ?? null,
      scan,
      scanAt: server.securityObservedAt?.toISOString() ?? null,
      serverStatus: server.status,
      serverId: server.id,
    });
    return {
      serverId: server.id,
      serverName: server.name,
      host: server.host,
      status: server.status,
      score: computeSecurityScore(checks),
      checks,
      components: {
        fail2ban: comps.get("fail2ban")
          ? { installed: comps.get("fail2ban")!.installed, running: comps.get("fail2ban")!.running }
          : undefined,
        ufw: comps.get("ufw")
          ? {
              installed: comps.get("ufw")!.installed,
              running: comps.get("ufw")!.running,
              active: scan?.ufwActive,
              openPorts: scan?.ufwOpenPorts,
            }
          : undefined,
        ngxblocker: comps.get("ngxblocker")
          ? { installed: comps.get("ngxblocker")!.installed, running: comps.get("ngxblocker")!.running }
          : undefined,
      },
      lastHealthAt: server.healthObservedAt?.toISOString() ?? null,
      lastSecurityScanAt: server.securityObservedAt?.toISOString() ?? null,
      securitySnapshot: scan,
    };
  }

  buildSiteReport(
    site: {
      id: string;
      domain: string;
      serverId: string;
      infoSnapshot: unknown;
      wpInventorySnapshot?: unknown;
      server?: { name: string } | null;
    },
    vulns: WpVulnHit[] = [],
  ): SiteSecurityReport {
    const info = site.infoSnapshot as SiteInfoSnapshot | null;
    const wpInventory = (site.wpInventorySnapshot as WpSiteInventory | null) ?? null;
    const checks = buildSiteChecks({
      siteId: site.id,
      serverId: site.serverId,
      info,
      wpInventory,
      vulns,
    });
    return {
      siteId: site.id,
      domain: site.domain,
      serverId: site.serverId,
      serverName: site.server?.name,
      score: computeSecurityScore(checks),
      checks,
      isWordPress: Boolean(info?.isWordPress || wpInventory),
    };
  }

  async getHub(user: SessionUser): Promise<SecurityHubResponse> {
    const [servers, sites] = await Promise.all([
      this.prisma.client.server.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        orderBy: { name: "asc" },
      }),
      this.prisma.client.site.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        include: { server: { select: { name: true } } },
        orderBy: { domain: "asc" },
        take: 200,
      }),
    ]);

    const serverReports = servers.map((s) => this.buildServerReport(s));

    const vulnBySite = new Map<string, WpVulnHit[]>();
    const wpSites = sites
      .map((s) => ({ site: s, inv: s.wpInventorySnapshot as WpSiteInventory | null }))
      .filter((x) => x.inv && !x.inv.error)
      .slice(0, 15);

    await Promise.all(
      wpSites.map(async ({ site, inv }) => {
        if (!inv) return;
        const plugins = (inv.plugins ?? [])
          .filter((p) => p.status !== "inactive")
          .slice(0, 12)
          .map((p) => ({ slug: pluginSlug(p.name), version: p.version }));
        const themes = (inv.themes ?? [])
          .filter((t) => t.status === "active" || !t.status)
          .slice(0, 4)
          .map((t) => ({ slug: pluginSlug(t.name), version: t.version }));
        const hits = await lookupWpVulnerabilities({
          coreVersion: inv.coreVersion,
          plugins,
          themes,
          maxItems: 10,
        });
        vulnBySite.set(site.id, hits);
      }),
    );

    const siteReports = sites.map((s) => this.buildSiteReport(s, vulnBySite.get(s.id) ?? []));
    const sitesAtRisk = siteReports
      .filter((s) => s.score.critical > 0 || s.score.warning > 0 || s.score.grade === "D" || s.score.grade === "F")
      .sort((a, b) => a.score.score - b.score.score)
      .slice(0, 20);

    const openAlerts = collectOpenAlerts({ servers: serverReports, sites: siteReports }).slice(0, 80);

    const summaryBase = mergeScores([
      ...serverReports.map((s) => s.score),
      ...siteReports.map((s) => s.score),
    ]);

    return {
      summary: { ...summaryBase, servers: serverReports.length, sites: siteReports.length },
      openAlerts,
      servers: serverReports,
      sitesAtRisk,
    };
  }

  async getServerSecurity(user: SessionUser, serverId: string) {
    const server = await this.requireServer(user, serverId);
    return this.buildServerReport(server);
  }

  async getSiteSecurity(user: SessionUser, siteId: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { name: true } } },
    });
    if (!site) throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Site não encontrado." } });
    const inv = site.wpInventorySnapshot as WpSiteInventory | null;
    let vulns: WpVulnHit[] = [];
    if (inv && !inv.error) {
      vulns = await lookupWpVulnerabilities({
        coreVersion: inv.coreVersion,
        plugins: (inv.plugins ?? []).slice(0, 12).map((p) => ({ slug: pluginSlug(p.name), version: p.version })),
        themes: (inv.themes ?? []).slice(0, 4).map((t) => ({ slug: pluginSlug(t.name), version: t.version })),
      });
    }
    return this.buildSiteReport(site, vulns);
  }

  async scanServer(user: SessionUser, serverId: string) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const server = await this.requireServer(user, serverId);
    if (!server) throw new BadRequestException({ error: { code: "INVALID", message: "Servidor inválido." } });

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: server.id,
      operationKey: OperationKeys.ServerSecurityScan,
      input: { serverId: server.id },
      idempotencyKey: `security-scan:${server.id}:${Date.now()}`,
    });

    return { jobId: job.id };
  }

  async refreshServerHealth(user: SessionUser, serverId: string) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const server = await this.requireServer(user, serverId);
    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: server.id,
      operationKey: OperationKeys.ServerHealthCollect,
      input: { serverId: server.id },
      idempotencyKey: `security-health:${server.id}:${Date.now()}`,
    });
    return { jobId: job.id };
  }
}
