import { describe, expect, it } from "vitest";
import { describeCron } from "../../../src/infrastructure/cron/describe.js";

describe("cron.describeCron", () => {
  it("returns a non-empty English description for a valid cron", () => {
    const text = describeCron("0 9 * * *");
    expect(text.length).toBeGreaterThan(0);
    expect(/[\u4e00-\u9fa5]/.test(text)).toBe(false);
    expect(text.toLowerCase()).toContain("at 09:00");
  });
});
