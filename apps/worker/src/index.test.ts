import { describe, expect, it } from "vitest";
import { parseWordOpsVersion } from "@opspanel/wordops";

describe("worker wordops integration", () => {
  it("parses version from probe output", () => {
    expect(parseWordOpsVersion("WordOps v3.22.0")).toBe("3.22.0");
  });
});
