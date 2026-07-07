// ============================================================
// Tests fuer parseEmailList().
// ============================================================
import { describe, it, expect } from "vitest";
import { parseEmailList, isEmailListValid } from "./parseEmailList";

describe("parseEmailList", () => {
  it("returns empty result for empty input", () => {
    expect(parseEmailList("")).toEqual({ recipients: [], invalid: [] });
    // @ts-expect-error null test
    expect(parseEmailList(null)).toEqual({ recipients: [], invalid: [] });
  });

  it("parses a single blank address", () => {
    const r = parseEmailList("a@b.com");
    expect(r.invalid).toEqual([]);
    expect(r.recipients).toEqual([{ address: "a@b.com" }]);
  });

  it("parses name+address in <> notation", () => {
    const r = parseEmailList("Bob <b@y.com>");
    expect(r.invalid).toEqual([]);
    expect(r.recipients).toEqual([{ name: "Bob", address: "b@y.com" }]);
  });

  it("splits by comma and semicolon", () => {
    const r = parseEmailList("a@b.com, c@d.com; Eve <e@f.com>");
    expect(r.invalid).toEqual([]);
    expect(r.recipients).toEqual([
      { address: "a@b.com" },
      { address: "c@d.com" },
      { name: "Eve", address: "e@f.com" },
    ]);
  });

  it("collects invalid entries", () => {
    const r = parseEmailList("a@b.com, not-an-email, c@d.com");
    expect(r.invalid).toEqual(["not-an-email"]);
    expect(r.recipients).toEqual([
      { address: "a@b.com" },
      { address: "c@d.com" },
    ]);
  });

  it("strips wrapping quotes from name", () => {
    const r = parseEmailList('"Bob Sender" <b@y.com>');
    expect(r.recipients).toEqual([{ name: "Bob Sender", address: "b@y.com" }]);
  });

  it("ignores empty segments", () => {
    const r = parseEmailList(",, a@b.com ,  ; ");
    expect(r.invalid).toEqual([]);
    expect(r.recipients).toEqual([{ address: "a@b.com" }]);
  });

  it("isEmailListValid mirrors invalid count", () => {
    expect(isEmailListValid("a@b.com, c@d.com")).toBe(true);
    expect(isEmailListValid("a@b.com, oops")).toBe(false);
    expect(isEmailListValid("")).toBe(true);
  });
});
