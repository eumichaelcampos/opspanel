import { describe, expect, it } from "vitest";
import {
  isStagingDomain,
  suggestStagingDomain,
  stagingSiteLabel,
} from "./staging-center.js";

describe("staging-center helpers", () => {
  it("detects staging domains", () => {
    expect(isStagingDomain("staging.exemplo.com")).toBe(true);
    expect(isStagingDomain("exemplo.com")).toBe(false);
    expect(isStagingDomain("Staging.Exemplo.COM")).toBe(true);
  });

  it("suggests staging subdomain", () => {
    expect(suggestStagingDomain("exemplo.com.br")).toBe("staging.exemplo.com.br");
    expect(suggestStagingDomain("staging.exemplo.com.br")).toBe("clone.exemplo.com.br");
  });

  it("labels staging sites", () => {
    expect(stagingSiteLabel({ domain: "staging.a.com", isStaging: true, clonedFrom: "a.com" })).toBe(
      "Staging de a.com",
    );
  });
});
