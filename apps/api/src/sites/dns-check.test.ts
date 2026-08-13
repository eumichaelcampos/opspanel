import { describe, expect, it } from "vitest";
import { buildDnsCheckMessage, compareDnsIps } from "./dns-check.js";

/** IP de documentação (RFC 5737), sem IPs reais de clientes. */
const SERVER_IP = "203.0.113.10";

describe("compareDnsIps", () => {
  it("returns ok when domain resolves to server ip", () => {
    expect(compareDnsIps([SERVER_IP], [SERVER_IP])).toBe("ok");
  });

  it("returns cloudflare when resolved ips are cloudflare", () => {
    expect(compareDnsIps([SERVER_IP], ["104.16.1.1", "172.64.0.10"])).toBe("cloudflare");
  });

  it("returns cloudflare when http detects cloudflare", () => {
    expect(compareDnsIps([SERVER_IP], ["192.0.2.1"], true)).toBe("cloudflare");
  });

  it("returns mismatch when ips differ", () => {
    expect(compareDnsIps([SERVER_IP], ["192.0.2.1"])).toBe("mismatch");
  });

  it("returns no_records when domain has no ips", () => {
    expect(compareDnsIps([SERVER_IP], [])).toBe("no_records");
  });
});

describe("buildDnsCheckMessage", () => {
  it("builds cloudflare message", () => {
    const msg = buildDnsCheckMessage("cloudflare", "exemplo.com", [SERVER_IP], ["104.16.1.1"]);
    expect(msg).toContain("Cloudflare");
    expect(msg).toContain(SERVER_IP);
  });

  it("builds mismatch message", () => {
    const msg = buildDnsCheckMessage("mismatch", "exemplo.com", [SERVER_IP], ["192.0.2.1"]);
    expect(msg).toContain("exemplo.com");
    expect(msg).toContain(SERVER_IP);
    expect(msg).toContain("192.0.2.1");
  });
});
