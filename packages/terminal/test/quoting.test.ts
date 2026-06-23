import { describe, expect, it } from "vitest";
import { escapeCmdArg, pwshEnvPrefix, pwshQuote, shExportPrefix, shQuote } from "../src/_shared.js";

describe("shQuote — POSIX single-quote escape", () => {
  it("wraps a plain string in single quotes", () => {
    expect(shQuote("hello")).toBe("'hello'");
  });

  it("escapes an embedded single quote with the '\\'' idiom", () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });

  it("handles multiple single quotes", () => {
    expect(shQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("handles an empty string", () => {
    expect(shQuote("")).toBe("''");
  });

  it("passes through spaces, $, `, and ! unchanged inside single quotes", () => {
    const dangerous = "$(rm -rf /) `whoami` !event";
    const quoted = shQuote(dangerous);
    expect(quoted).toBe(`'$(rm -rf /) \`whoami\` !event'`);
    expect(quoted).not.toContain("\\$");
  });

  it("passes through backslashes unchanged (POSIX single quotes are literal)", () => {
    expect(shQuote("a\\b")).toBe("'a\\b'");
  });

  it("handles a string that is a single quote", () => {
    expect(shQuote("'")).toBe("''\\'''");
  });
});

describe("escapeCmdArg — cmd.exe double-quote + caret escape", () => {
  it("wraps a plain string in double quotes", () => {
    expect(escapeCmdArg("hello")).toBe('"hello"');
  });

  it("escapes & with ^&", () => {
    expect(escapeCmdArg("a&b")).toBe('"a^&b"');
  });

  it("escapes | with ^|", () => {
    expect(escapeCmdArg("a|b")).toBe('"a^|b"');
  });

  it("escapes < and > with ^< and ^>", () => {
    expect(escapeCmdArg("a<b>c")).toBe('"a^<b^>c"');
  });

  it("escapes ^ with ^^", () => {
    expect(escapeCmdArg("a^b")).toBe('"a^^b"');
  });

  it("escapes % with ^% (blocks variable expansion)", () => {
    expect(escapeCmdArg("%PATH%")).toBe('"^%PATH^%"');
  });

  it("escapes ! with ^! (blocks delayed expansion)", () => {
    expect(escapeCmdArg("!var!")).toBe('"^!var^!"');
  });

  it('escapes " with ^" (prevents quote injection)', () => {
    expect(escapeCmdArg('a"b')).toBe('"a^"b"');
  });

  it("escapes parentheses (FOR/IF block syntax)", () => {
    expect(escapeCmdArg("(a)")).toBe('"^(a^)"');
  });

  it("passes through spaces safely (they are inside double quotes)", () => {
    expect(escapeCmdArg("C:\\Program Files\\app")).toBe('"C:\\Program Files\\app"');
  });

  it("handles an empty string", () => {
    expect(escapeCmdArg("")).toBe('""');
  });

  it("escapes multiple metacharacters in sequence", () => {
    expect(escapeCmdArg("a&b|c")).toBe('"a^&b^|c"');
  });
});

describe("pwshQuote — PowerShell single-quote escape", () => {
  it("wraps a plain string in single quotes", () => {
    expect(pwshQuote("hello")).toBe("'hello'");
  });

  it("doubles embedded single quotes (pwsh rule: '' = literal ')", () => {
    expect(pwshQuote("it's")).toBe("'it''s'");
  });

  it("handles multiple single quotes", () => {
    expect(pwshQuote("a'b'c")).toBe("'a''b''c'");
  });

  it("handles an empty string", () => {
    expect(pwshQuote("")).toBe("''");
  });

  it("passes through $, @, and backticks unchanged (no interpolation in pwsh '…')", () => {
    const dangerous = "$env:PATH @(1,2) `cmd`";
    const quoted = pwshQuote(dangerous);
    expect(quoted).toBe("'$env:PATH @(1,2) `cmd`'");
  });

  it("passes through semicolons unchanged (quoting is shell-internal)", () => {
    expect(pwshQuote("a;b")).toBe("'a;b'");
  });

  it("handles a string that is a single quote", () => {
    expect(pwshQuote("'")).toBe("''''");
  });
});

describe("shExportPrefix — POSIX export prefix builder", () => {
  it("returns empty string for undefined env", () => {
    expect(shExportPrefix(undefined)).toBe("");
  });

  it("returns empty string for empty env", () => {
    expect(shExportPrefix({})).toBe("");
  });

  it("builds a single export assignment", () => {
    expect(shExportPrefix({ FOO: "bar" })).toBe("export FOO='bar' && ");
  });

  it("builds multiple assignments in insertion order", () => {
    const result = shExportPrefix({ A: "1", B: "2" });
    expect(result).toBe("export A='1' B='2' && ");
  });

  it("quotes values containing single quotes", () => {
    const result = shExportPrefix({ MSG: "it's" });
    expect(result).toBe("export MSG='it'\\''s' && ");
  });
});

describe("pwshEnvPrefix — PowerShell $env: prefix builder", () => {
  it("returns empty string for undefined env", () => {
    expect(pwshEnvPrefix(undefined)).toBe("");
  });

  it("returns empty string for empty env", () => {
    expect(pwshEnvPrefix({})).toBe("");
  });

  it("builds a single $env: assignment", () => {
    expect(pwshEnvPrefix({ FOO: "bar" })).toBe("$env:FOO = 'bar'; ");
  });

  it("builds multiple assignments in insertion order", () => {
    const result = pwshEnvPrefix({ A: "1", B: "2" });
    expect(result).toBe("$env:A = '1'; $env:B = '2'; ");
  });

  it("quotes values containing single quotes via '' doubling", () => {
    const result = pwshEnvPrefix({ MSG: "it's" });
    expect(result).toBe("$env:MSG = 'it''s'; ");
  });
});
