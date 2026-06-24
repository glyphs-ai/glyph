import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionError, SessionPathEscapeError } from "../src/errors.js";
import { safeJoinUnderRoot } from "../src/session-service/_helpers.js";

const isWin = process.platform === "win32";

describe("safeJoinUnderRoot", () => {
  const root = path.resolve("/some/root");

  it("returns child path for valid id", () => {
    const out = safeJoinUnderRoot(root, "20260508-9dfbdf05");
    expect(out).toBe(path.join(root, "20260508-9dfbdf05"));
  });

  it("rejects ids that escape via ..", () => {
    expect(() => safeJoinUnderRoot(root, "..")).toThrow(SessionPathEscapeError);
    expect(() => safeJoinUnderRoot(root, path.join("..", "sibling"))).toThrow(
      SessionPathEscapeError,
    );
  });

  it.runIf(!isWin)("rejects absolute path id on POSIX", () => {
    expect(() => safeJoinUnderRoot(root, "/etc/passwd")).toThrow(SessionPathEscapeError);
  });

  it("rejects empty id (would equal root)", () => {
    expect(() => safeJoinUnderRoot(root, "")).toThrow(SessionPathEscapeError);
  });

  it("treats /a/b vs /a/bb correctly (separator-suffixed root check)", () => {
    const r = path.resolve("/a/b");
    expect(() => safeJoinUnderRoot(r, path.join("..", "bb"))).toThrow(SessionPathEscapeError);
  });

  it("thrown error is instanceof SessionError with stable name", () => {
    try {
      safeJoinUnderRoot(root, "..");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      expect(err).toBeInstanceOf(SessionPathEscapeError);
      expect((err as SessionPathEscapeError).name).toBe("SessionPathEscapeError");
    }
  });
});
