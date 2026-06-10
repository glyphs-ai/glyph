import { describe, expect, it } from "vitest";
import { pwshEnvPrefix, shExportPrefix } from "../src/_shared.js";

/**
 * Tests the defence-in-depth filter inside the env
 * prefix builders (`shExportPrefix`, `pwshEnvPrefix` in `_shared.ts`).
 *
 * The typed contract for `LaunchCommand.env` is
 * `Readonly<Record<string, string>>`, but non-string values can still
 * slip in via an unchecked `as`-cast over `NodeJS.ProcessEnv` at the
 * assembly site. Without this filter, `shQuote(value)` /
 * `pwshQuote(value)` would crash when `.replace(...)` is unavailable. The
 * primary guard lives upstream where the env bag is assembled; this
 * test pins the secondary guard inside the prefix builders. The builders
 * drop bad entries and emit the rest verbatim before quoting.
 */
describe("env prefix builders: defence-in-depth string-value filter", () => {
  it("shExportPrefix skips non-string values without throwing", () => {
    const env = {
      KEEP: "yes",
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_UNDEF: undefined as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_NULL: null as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_NUMBER: 123 as any,
    } as Record<string, string>;
    const out = shExportPrefix(env);
    expect(out).toContain("KEEP='yes'");
    expect(out).not.toContain("DROP_UNDEF");
    expect(out).not.toContain("DROP_NULL");
    expect(out).not.toContain("DROP_NUMBER");
  });

  it("pwshEnvPrefix skips non-string values without throwing", () => {
    const env = {
      KEEP: "yes",
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_UNDEF: undefined as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_NULL: null as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      DROP_BOOL: false as any,
    } as Record<string, string>;
    const out = pwshEnvPrefix(env);
    expect(out).toContain("$env:KEEP = 'yes'");
    expect(out).not.toContain("DROP_UNDEF");
    expect(out).not.toContain("DROP_NULL");
    expect(out).not.toContain("DROP_BOOL");
  });

  it("returns empty string when EVERY entry is filtered out", () => {
    const env = {
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      A: undefined as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed env probe
      B: undefined as any,
    } as Record<string, string>;
    expect(shExportPrefix(env)).toBe("");
    expect(pwshEnvPrefix(env)).toBe("");
  });
});
