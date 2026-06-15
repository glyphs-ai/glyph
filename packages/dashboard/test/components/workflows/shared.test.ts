import { describe, expect, it } from "vitest";
import { statusGroup } from "../../../src/components/workflows/shared";

describe("statusGroup", () => {
  it("returns 'awaiting' when status is running and awaitingHumanCount > 0", () => {
    expect(statusGroup("running", 1)).toBe("awaiting");
    expect(statusGroup("running", 3)).toBe("awaiting");
  });

  it("returns 'running' when status is running and awaitingHumanCount is 0", () => {
    expect(statusGroup("running", 0)).toBe("running");
  });

  it("returns 'completed' for all terminal statuses regardless of awaitingHumanCount", () => {
    expect(statusGroup("succeeded", 0)).toBe("completed");
    expect(statusGroup("failed", 0)).toBe("completed");
    expect(statusGroup("cancelled", 0)).toBe("completed");
    expect(statusGroup("succeeded", 1)).toBe("completed");
  });
});
