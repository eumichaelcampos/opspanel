import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootEnv = resolve(pkgDir, "../../.env");

try {
  const envText = readFileSync(rootEnv, "utf8");
  for (const line of envText.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch {
  console.error(`Não foi possível ler ${rootEnv}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida no .env");
  process.exit(1);
}

execSync("prisma migrate deploy", {
  stdio: "inherit",
  env: process.env,
  cwd: pkgDir,
});
