import { describe, expect, it } from "vitest";
import { pickPreferredPhpVersion, installedPhpVersionsFromStack } from "./wordops-php-resolve.js";

describe("pickPreferredPhpVersion", () => {
  const stack = [
    { id: "php83", installed: true, running: true },
    { id: "nginx", installed: true, running: true },
  ];

  it("falls back from 84 to 83 when php84 is missing", () => {
    const result = pickPreferredPhpVersion("84", stack);
    expect(result.phpVersion).toBe("83");
    expect(result.fallbackApplied).toBe(true);
  });

  it("keeps requested version when installed", () => {
    const with84 = [...stack, { id: "php84", installed: true, running: true }];
    const result = pickPreferredPhpVersion("84", with84);
    expect(result.phpVersion).toBe("84");
    expect(result.fallbackApplied).toBe(false);
  });

  it("lists installed php versions in preference order", () => {
    expect(installedPhpVersionsFromStack(stack)).toEqual(["83"]);
  });
});
