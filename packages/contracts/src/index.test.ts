import { describe, expect, it } from "vitest";
import { serverConnectionTestInputSchema } from "./index.js";

describe("serverConnectionTestInputSchema", () => {
  it("accepts valid uuid", () => {
    const result = serverConnectionTestInputSchema.safeParse({
      serverId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });
});
