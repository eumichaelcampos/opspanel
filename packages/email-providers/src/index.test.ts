import { describe, expect, it } from "vitest";
import { defaultAtriomailDnsBundle } from "./health.js";

describe("defaultAtriomailDnsBundle", () => {
  it("builds mx and spf records", () => {
    const bundle = defaultAtriomailDnsBundle({
      domain: "exemplo.com.br",
      mxHost: "mail.example.com",
      spfInclude: "spf.example.com",
    });
    expect(bundle.mx[0]?.host).toBe("mail.example.com");
    expect(bundle.txt.some((t) => t.content.includes("spf.example.com"))).toBe(true);
    expect(bundle.txt.some((t) => t.name.startsWith("_dmarc"))).toBe(true);
  });
});
