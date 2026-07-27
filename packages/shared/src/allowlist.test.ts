import { describe, it, expect } from "vitest";
import { matchHostname, isProdEnvironment } from "@directdom/shared";

describe("allowlist", () => {
  it("allows local admin intranet", () => {
    const result = matchHostname("adminv2.local.intranet.1stdibs.com");
    expect(result.allowed).toBe(true);
    expect(result.environment).toBe("qa");
  });

  it("allows local intranet", () => {
    const result = matchHostname("local.intranet.1stdibs.com");
    expect(result.allowed).toBe(true);
    expect(result.environment).toBe("qa");
  });

  it("allows qa admin intranet", () => {
    const result = matchHostname("adminv2.qa.intranet.1stdibs.com");
    expect(result.allowed).toBe(true);
    expect(result.environment).toBe("qa");
  });

  it("allows stage public", () => {
    const result = matchHostname("stage.1stdibs.com");
    expect(result.allowed).toBe(true);
    expect(result.environment).toBe("stage");
  });

  it("allows prod admin", () => {
    const result = matchHostname("adminv2.1stdibs.com");
    expect(result.allowed).toBe(true);
    expect(isProdEnvironment(result.environment)).toBe(true);
  });

  it("rejects unknown hosts", () => {
    const result = matchHostname("evil.example.com");
    expect(result.allowed).toBe(false);
  });
});
