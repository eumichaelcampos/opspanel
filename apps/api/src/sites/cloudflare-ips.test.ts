import { describe, expect, it } from "vitest";
import { isCloudflareIp, isIpv4InCidr, resolvedViaCloudflare } from "./cloudflare-ips.js";

describe("cloudflare-ips", () => {
  it("matches known Cloudflare ipv4", () => {
    expect(isCloudflareIp("104.21.55.22")).toBe(true);
    expect(isCloudflareIp("173.245.48.1")).toBe(true);
  });

  it("rejects non-cloudflare ipv4", () => {
    expect(isCloudflareIp("203.0.113.10")).toBe(false);
  });

  it("checks cidr membership", () => {
    expect(isIpv4InCidr("104.16.1.1", "104.16.0.0/13")).toBe(true);
    expect(isIpv4InCidr("8.8.8.8", "104.16.0.0/13")).toBe(false);
  });

  it("detects all-cloudflare resolution", () => {
    expect(resolvedViaCloudflare(["104.16.1.1", "172.64.0.10"])).toBe(true);
    expect(resolvedViaCloudflare(["104.16.1.1", "203.0.113.10"])).toBe(false);
  });
});
