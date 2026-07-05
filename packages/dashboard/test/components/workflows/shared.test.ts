import { describe, expect, it } from "vitest";
import { statusGroup } from "../../../src/components/workflows/shared";

describe("statusGroup", () => {
  it("returns 'running' when status is running", () => {
    expect(statusGroup("running")).toBe("running");
  });

  it("returns 'completed' for all terminal statuses", () => {
    expect(statusGroup("succeeded")).toBe("completed");
    expect(statusGroup("failed")).toBe("completed");
    expect(statusGroup("cancelled")).toBe("completed");
  });
});
