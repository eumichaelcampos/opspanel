import { describe, expect, it } from "vitest";
import { parseSiteListOutput } from "./index.js";

describe("parseSiteListOutput", () => {
  it("parses domains from typical list output", () => {
    const output = `
Site domain     Type       Status
example.com     WordPress  enabled
blog.example.org PHP       disabled
`;
    const entries = parseSiteListOutput(output);
    expect(entries.map((e) => e.domain)).toEqual(["example.com", "blog.example.org"]);
  });
});
