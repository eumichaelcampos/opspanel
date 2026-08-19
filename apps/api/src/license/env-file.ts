import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), "../../.env");
const WEB_ENV_LOCAL = resolve(process.cwd(), "../../apps/web/.env.local");

/** Atualiza ou insere variável no .env da instância (persiste após restart). */
export function patchEnvFile(key: string, value: string, filePath: string = ENV_PATH): void {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    content = "";
  }
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, "m");
  const next = regex.test(content)
    ? content.replace(regex, line)
    : `${content.trimEnd()}\n${line}\n`;
  writeFileSync(filePath, next, "utf8");
}

/** Atualiza WEB_URL/API_URL no .env raiz e no apps/web/.env.local. */
export function patchPanelUrls(webUrl: string, apiUrl: string = webUrl): void {
  const web = webUrl.replace(/\/$/, "");
  const api = apiUrl.replace(/\/$/, "");
  patchEnvFile("WEB_URL", web, ENV_PATH);
  patchEnvFile("API_URL", api, ENV_PATH);
  process.env.WEB_URL = web;
  process.env.API_URL = api;

  let webLocal = "";
  if (existsSync(WEB_ENV_LOCAL)) {
    try {
      webLocal = readFileSync(WEB_ENV_LOCAL, "utf8");
    } catch {
      webLocal = "";
    }
  }
  const line = `API_URL=${api}`;
  const regex = /^API_URL=.*$/m;
  const next = regex.test(webLocal)
    ? webLocal.replace(regex, line)
    : `${webLocal.trimEnd()}\n${line}\n`;
  writeFileSync(WEB_ENV_LOCAL, next.startsWith("\n") ? next.slice(1) : next, "utf8");
}
