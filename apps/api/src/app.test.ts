import { describe, expect, it } from "vitest";
import { OperationKeys } from "@opspanel/contracts";

describe("operation keys", () => {
  it("includes server connection test", () => {
    expect(OperationKeys.ServerConnectionTest).toBe("server.connection.test");
  });
});
