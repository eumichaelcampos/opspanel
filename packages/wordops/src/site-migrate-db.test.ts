import { describe, expect, it } from "vitest";
import {
  buildSiteMigrateDbHealthScript,
  buildSiteMigrateImportScript,
  buildSiteMigrateOriginPhpDumpScript,
} from "./site-ops.js";

describe("site migrate db resilience", () => {
  it("import script does not emit then; and uses newlines", () => {
    const script = buildSiteMigrateImportScript({
      domain: "exemplo.com.br",
      destDb: { name: "db", user: "u", pass: "p", host: "localhost" },
      remoteDb: { host: "1.2.3.4", name: "sdb", user: "su", password: "sp" },
      oldUrl: "https://old.exemplo.com.br",
      multisiteMode: "subdir",
    });
    expect(script).not.toMatch(/then;/);
    expect(script).toContain("OPS_MIGRATE_OK=1");
    expect(script).not.toContain("column-statistics");
    expect(script).not.toContain("set-gtid-purged");
  });

  it("builds ftp php dump fallback without shell-breaking then;", () => {
    const script = buildSiteMigrateOriginPhpDumpScript({
      domain: "exemplo.com.br",
      ftp: {
        protocol: "ftp",
        host: "ftp.exemplo.com",
        username: "user@exemplo.com",
        password: "example-ftp-pass",
      },
      remoteDb: { host: "ftp.exemplo.com", name: "db", user: "dbu", password: "dbp" },
      httpHost: "exemplo.com.br",
    });
    expect(script).toContain("OPS_MIGRATE_FTP_PHP_DUMP_OK=1");
    expect(script).toContain("base64_decode");
    expect(script).not.toMatch(/then;/);
  });

  it("health script requires tables for prefix", () => {
    const script = buildSiteMigrateDbHealthScript("exemplo.com.br");
    expect(script).toContain("OPS_MIGRATE_DB_HEALTH_OK=1");
    expect(script).toContain("db_tables_missing");
  });
});
