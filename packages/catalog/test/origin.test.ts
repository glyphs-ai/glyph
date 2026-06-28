import { describe, expect, it } from "vitest";
import { FetchError, FetcherError, OriginParseError } from "../src/fetcher/index.js";
import { normalizeOrigin, parseOrigin, safeNormalize, sameOrigin } from "../src/fetcher/origin.js";

describe("parseOrigin", () => {
  it("parses file: URI with absolute path", () => {
    const o = parseOrigin("file:/abs/path/to/skill");
    expect(o.scheme).toBe("file");
    if (o.scheme !== "file") throw new Error("narrow");
    expect(o.path).toBe("/abs/path/to/skill");
  });

  it("accepts file:/// triple-slash form (RFC 8089)", () => {
    const o = parseOrigin("file:///abs/path");
    expect(o.scheme).toBe("file");
    if (o.scheme !== "file") throw new Error("narrow");
    expect(o.path).toBe("/abs/path");
  });

  it("accepts Windows drive paths", () => {
    const o = parseOrigin("file:C:/Users/lang/skill");
    expect(o.scheme).toBe("file");
    if (o.scheme !== "file") throw new Error("narrow");
    expect(o.path).toBe("C:/Users/lang/skill");
  });

  it("accepts file:///C:/... Windows triple-slash form", () => {
    const o = parseOrigin("file:///C:/Users/lang/skill");
    expect(o.scheme).toBe("file");
    if (o.scheme !== "file") throw new Error("narrow");
    expect(o.path).toBe("C:/Users/lang/skill");
  });

  it("rejects file: URI with relative path", () => {
    expect(() => parseOrigin("file:./relative")).toThrow(OriginParseError);
    expect(() => parseOrigin("file:relative")).toThrow(OriginParseError);
    expect(() => parseOrigin("file:../sibling")).toThrow(OriginParseError);
  });

  it("rejects file: URI with home expansion (~)", () => {
    expect(() => parseOrigin("file:~/skills")).toThrow(OriginParseError);
  });

  it("parses github tree URL with subpath", () => {
    const o = parseOrigin("https://github.com/anthropic/skills/tree/main/tool-use");
    expect(o.scheme).toBe("github");
    if (o.scheme !== "github") throw new Error("narrow");
    expect(o.owner).toBe("anthropic");
    expect(o.repo).toBe("skills");
    expect(o.ref).toBe("main");
    expect(o.path).toBe("tool-use");
  });

  it("parses github tree URL with no subpath", () => {
    const o = parseOrigin("https://github.com/me/repo/tree/main");
    expect(o.scheme).toBe("github");
    if (o.scheme !== "github") throw new Error("narrow");
    expect(o.path).toBeNull();
  });

  it("rejects empty input with OriginParseError", () => {
    expect(() => parseOrigin("")).toThrow(OriginParseError);
  });

  it("rejects unknown scheme", () => {
    expect(() => parseOrigin("npm:something")).toThrow(OriginParseError);
  });

  it("rejects github URL without /tree/<ref>", () => {
    expect(() => parseOrigin("https://github.com/me/repo")).toThrow(OriginParseError);
  });
});

describe("normalizeOrigin", () => {
  it("returns canonical github form", () => {
    const a = normalizeOrigin(parseOrigin("https://github.com/MyOrg/Repo/tree/main/path"));
    expect(a).toBe("https://github.com/myorg/repo/tree/main/path");
  });

  it("treats github URL with and without trailing slash as same", () => {
    const a = normalizeOrigin(parseOrigin("https://github.com/me/repo/tree/main/path/"));
    const b = normalizeOrigin(parseOrigin("https://github.com/me/repo/tree/main/path"));
    expect(a).toBe(b);
  });

  it("file: collapses Windows backslash and forward-slash forms to one canonical key", () => {
    const a = normalizeOrigin(parseOrigin("file:F:\\path\\x"));
    const b = normalizeOrigin(parseOrigin("file:F:/path/x"));
    expect(a).toBe("file:///F:/path/x");
    expect(b).toBe(a);
  });

  it("file: trims a single trailing slash but preserves POSIX root", () => {
    expect(normalizeOrigin(parseOrigin("file:///F:/path/x/"))).toBe("file:///F:/path/x");
    // POSIX root must survive intact — `file:/` would parse as the root
    // directory; the trailing-slash trim must not strip it down to `file:///`.
    expect(normalizeOrigin(parseOrigin("file:/"))).toBe("file:///");
  });

  it("file: leaves a POSIX absolute path unchanged apart from the canonical `///` prefix", () => {
    // Separator translation is a no-op when the input is already
    // canonical POSIX; the only transform is re-asserting `file:///`.
    expect(normalizeOrigin(parseOrigin("file:/abs/path"))).toBe("file:///abs/path");
    expect(normalizeOrigin(parseOrigin("file:///abs/path"))).toBe("file:///abs/path");
  });

  it("file: translation runs after the leading-slash strip so backslashes after `/` collapse too", () => {
    // `file:/F:\\path\\x` first gets its leading `/` stripped (Windows
    // drive-letter shape per parseOrigin), then backslashes translate.
    expect(normalizeOrigin(parseOrigin("file:/F:\\path\\x"))).toBe("file:///F:/path/x");
  });
});

describe("sameOrigin (file: cross-separator)", () => {
  it("treats backslash and forward-slash forms as the same origin", () => {
    expect(sameOrigin("file:F:\\x", "file:F:/x")).toBe(true);
  });

  it("ignores a single trailing slash on the file: path", () => {
    expect(sameOrigin("file:F:/x/", "file:F:/x")).toBe(true);
  });

  it("does not collapse genuinely different file: paths", () => {
    expect(sameOrigin("file:F:/x", "file:F:/y")).toBe(false);
  });
});

describe("safeNormalize", () => {
  it("returns the canonical form for parseable origins", () => {
    expect(safeNormalize("file:F:\\path\\x")).toBe("file:///F:/path/x");
    expect(safeNormalize("file:F:/path/x/")).toBe("file:///F:/path/x");
  });

  it("returns the input verbatim when the origin cannot be parsed", () => {
    expect(safeNormalize("not-a-uri")).toBe("not-a-uri");
    expect(safeNormalize("")).toBe("");
    expect(safeNormalize("file:./relative")).toBe("file:./relative");
  });

  it("does not throw on garbage input", () => {
    // Lookup callers must never have to wrap this in try/catch — a
    // malformed origin lookup must produce a non-match, not a throw.
    expect(() => safeNormalize("file:")).not.toThrow();
    expect(() => safeNormalize("ftp://nope")).not.toThrow();
  });
});

describe("parseOrigin — Azure DevOps Services", () => {
  it("parses a simple dev.azure.com URL with a directory path", () => {
    const o = parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/skills/x");
    expect(o.scheme).toBe("azure-devops");
    if (o.scheme !== "azure-devops") throw new Error("narrow");
    expect(o.org).toBe("MyOrg");
    expect(o.project).toBe("MyProject");
    expect(o.repo).toBe("MyRepo");
    expect(o.path).toBe("/skills/x");
  });

  it("URL-decodes a project name with %20 spaces", () => {
    const o = parseOrigin(
      "https://dev.azure.com/O365Exchange/O365%20Core/_git/M365Bestla?path=/.claude/skills/bestla-pr-review",
    );
    expect(o.scheme).toBe("azure-devops");
    if (o.scheme !== "azure-devops") throw new Error("narrow");
    expect(o.project).toBe("O365 Core");
    expect(o.org).toBe("O365Exchange");
    expect(o.repo).toBe("M365Bestla");
    expect(o.path).toBe("/.claude/skills/bestla-pr-review");
  });

  it("rejects &version=GBmain with an actionable ref-pinning message", () => {
    expect(() =>
      parseOrigin(
        "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/skills/x&version=GBmain",
      ),
    ).toThrow(/version=.*not supported/i);
  });

  it("rejects {org}.visualstudio.com legacy host with a dev.azure.com pointer", () => {
    expect(() =>
      parseOrigin(
        "https://contoso.visualstudio.com/DefaultCollection/MyProject/_git/MyRepo?path=/x",
      ),
    ).toThrow(/visualstudio\.com is the legacy/i);
  });

  it("rejects on-prem TFS tfs.<x>.com/tfs/... URLs", () => {
    expect(() =>
      parseOrigin("https://tfs.foo.com/tfs/DefaultCollection/Proj/_git/Repo?path=/x"),
    ).toThrow(/on-prem.*tfs/i);
  });

  it("rejects dev.azure.com URL with missing ?path=", () => {
    expect(() => parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo")).toThrow(
      /requires a \?path/i,
    );
  });

  it("rejects dev.azure.com URL with empty ?path=", () => {
    expect(() => parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=")).toThrow(
      /requires a \?path/i,
    );
  });

  it("rejects dev.azure.com URL with malformed path segments (no _git)", () => {
    expect(() => parseOrigin("https://dev.azure.com/MyOrg/MyProject/MyRepo?path=/x")).toThrow(
      /must be of the form/i,
    );
  });

  it("normalizeOrigin round-trips an ADO origin (parse → normalize → reparse → normalize stable)", () => {
    const input =
      "https://dev.azure.com/O365Exchange/O365%20Core/_git/M365Bestla?path=/.claude/skills/bestla-pr-review";
    const normOnce = normalizeOrigin(parseOrigin(input));
    const normTwice = normalizeOrigin(parseOrigin(normOnce));
    expect(normTwice).toBe(normOnce);
    expect(normOnce).toBe(input);
  });

  it("treats two equivalent ADO URLs (trailing path slash) as the same normalized form", () => {
    const a = normalizeOrigin(
      parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/skills/x/"),
    );
    const b = normalizeOrigin(
      parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/skills/x"),
    );
    expect(a).toBe(b);
  });

  it("does NOT case-fold org or repo (ADO is case-sensitive, unlike GitHub)", () => {
    const a = normalizeOrigin(
      parseOrigin("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/x"),
    );
    const b = normalizeOrigin(
      parseOrigin("https://dev.azure.com/myorg/MyProject/_git/myrepo?path=/x"),
    );
    expect(a).not.toBe(b);
    expect(a).toContain("/MyOrg/");
    expect(a).toContain("/MyRepo?");
  });
});

describe("error hierarchy", () => {
  it("OriginParseError extends FetcherError", () => {
    const e = new OriginParseError("bad", "reason");
    expect(e).toBeInstanceOf(FetcherError);
  });

  it("FetchError extends FetcherError", () => {
    const e = new FetchError("uri", "boom");
    expect(e).toBeInstanceOf(FetcherError);
  });
});
