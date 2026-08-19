import { describe, expect, it } from "vitest";
import { googleBrokerCompleteUrl, isAllowedOAuthReturnUrl } from "./google-oauth-broker.util";

describe("isAllowedOAuthReturnUrl", () => {
  it("accepts instance complete callback", () => {
    expect(isAllowedOAuthReturnUrl("https://painel.cliente.com/api/v1/me/google-drive/oauth/complete")).toBe(true);
    expect(isAllowedOAuthReturnUrl("http://10.0.0.8:3000/api/v1/me/google-drive/oauth/complete")).toBe(true);
  });

  it("rejects other paths and schemes", () => {
    expect(isAllowedOAuthReturnUrl("https://evil.example/api/v1/me/google-drive/oauth/callback")).toBe(false);
    expect(isAllowedOAuthReturnUrl("https://painel.cliente.com/settings/account")).toBe(false);
    expect(isAllowedOAuthReturnUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedOAuthReturnUrl("https://user:pass@painel.cliente.com/api/v1/me/google-drive/oauth/complete")).toBe(
      false,
    );
  });
});

describe("googleBrokerCompleteUrl", () => {
  it("builds complete path from panel url", () => {
    expect(googleBrokerCompleteUrl("http://10.0.0.8:3000/")).toBe(
      "http://10.0.0.8:3000/api/v1/me/google-drive/oauth/complete",
    );
  });
});
