import { describe, expect, it } from "vitest";
import { formatRemoteCommand, parseSiteListOutput, parseWordOpsVersion } from "./index.js";

describe("parseWordOpsVersion", () => {
  it("parses version string", () => {
    expect(parseWordOpsVersion("WordOps v3.22.0")).toBe("3.22.0");
  });
});

describe("formatRemoteCommand", () => {
  it("quotes bash login-shell probes", () => {
    expect(formatRemoteCommand(["bash", "-lc", "wo site list"])).toBe("bash -lc 'wo site list'");
  });

  it("quotes simple argv probes", () => {
    expect(formatRemoteCommand(["cat", "/etc/os-release"])).toBe("cat /etc/os-release");
  });
});

describe("parseSiteListOutput", () => {
  it("parses plain lines", () => {
    const entries = parseSiteListOutput("example.com\nblog.example.org");
    expect(entries.map((e) => e.domain)).toEqual(["example.com", "blog.example.org"]);
  });

  it("parses wo site list with ANSI colors", () => {
    const output = "\u001b[94mnutreum.com.br\u001b[0m\n";
    expect(parseSiteListOutput(output).map((e) => e.domain)).toEqual(["nutreum.com.br"]);
  });

  it("parses table output from wo site list", () => {
    const output = `
+----+---------------+--------+
| id | domain        | status |
+----+---------------+--------+
| 1  | exemplo.com   | live   |
| 2  | loja.com.br   | live   |
+----+---------------+--------+
`;
    expect(parseSiteListOutput(output).map((e) => e.domain)).toEqual(["exemplo.com", "loja.com.br"]);
  });
});
