import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { SessionIdSchema } from "../../src/domain/session-id.js";

describe("SessionIdSchema", () => {
  it("accepts a canonical YYYYMMDD-xxxxxxxx id", () => {
    const id = "20260508-9dfbdf05";
    expect(SessionIdSchema.parse(id)).toBe(id);
  });

  it("rejects an empty string", () => {
    expect(() => SessionIdSchema.parse("")).toThrow(ZodError);
  });

  it("rejects an uppercase hex suffix", () => {
    expect(() => SessionIdSchema.parse("20260508-9DFBDF05")).toThrow(ZodError);
  });

  it("rejects a too-short hex suffix", () => {
    expect(() => SessionIdSchema.parse("20260508-9dfbdf0")).toThrow(ZodError);
  });

  it("rejects a trailing-extra string that contains a valid id prefix", () => {
    expect(() => SessionIdSchema.parse("20260508-9dfbdf05-extra")).toThrow(ZodError);
  });
});
