/** WordPress Center: inventário e atualizações por site. */

export type WpPluginInfo = {
  name: string;
  status?: string;
  version?: string;
  update?: string | null;
  updateVersion?: string | null;
  title?: string;
};

export type WpThemeInfo = {
  name: string;
  status?: string;
  version?: string;
  update?: string | null;
  updateVersion?: string | null;
  title?: string;
};

export type WpSiteInventory = {
  collectedAt: string;
  domain?: string;
  coreVersion?: string;
  coreUpdateAvailable?: boolean;
  coreUpdateVersion?: string | null;
  isMultisite?: boolean;
  plugins: WpPluginInfo[];
  themes: WpThemeInfo[];
  pluginUpdates: number;
  themeUpdates: number;
  error?: string;
};

export type WpSiteHubItem = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  siteType?: string | null;
  inventory: WpSiteInventory | null;
  lastInventoryAt?: string | null;
  needsRefresh: boolean;
};

export type WpHubResponse = {
  summary: {
    sites: number;
    withInventory: number;
    coreUpdates: number;
    pluginUpdates: number;
    themeUpdates: number;
  };
  sites: WpSiteHubItem[];
};

export type WpSiteDetailResponse = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  siteType?: string | null;
  isWordPress: boolean;
  inventory: WpSiteInventory | null;
  lastInventoryAt?: string | null;
};

export function countWpUpdates(inv: WpSiteInventory | null | undefined): {
  core: number;
  plugins: number;
  themes: number;
  total: number;
} {
  if (!inv) return { core: 0, plugins: 0, themes: 0, total: 0 };
  const core = inv.coreUpdateAvailable ? 1 : 0;
  const plugins = inv.pluginUpdates ?? inv.plugins.filter((p) => p.update && p.update !== "none").length;
  const themes = inv.themeUpdates ?? inv.themes.filter((t) => t.update && t.update !== "none").length;
  return { core, plugins, themes, total: core + plugins + themes };
}
