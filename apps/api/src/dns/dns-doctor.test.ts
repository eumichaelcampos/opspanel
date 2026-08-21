import { describe, expect, it } from "vitest";
import { DNS_TEMPLATES, dnsVerdictLabel } from "@opspanel/contracts";

describe("dns doctor contracts", () => {
  it("exposes static templates", () => {
    expect(DNS_TEMPLATES.map((t) => t.id)).toEqual(["wordpress", "email", "redirect"]);
  });

  it("labels verdicts in Portuguese", () => {
    expect(dnsVerdictLabel("mispointed")).toBe("Apontamento incorreto");
    expect(dnsVerdictLabel("healthy")).toBe("Saudável");
  });
});
