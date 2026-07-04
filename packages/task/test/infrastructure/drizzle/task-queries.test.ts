import { describe, expect, it } from "vitest";
import { normalizeArtifactRel } from "../../../src/infrastructure/drizzle/task-queries.js";

const ID = "20260508-9dfbdf05";

describe("normalizeArtifactRel", () => {
  it("passes a relative entry through unchanged", () => {
    expect(normalizeArtifactRel("ref/test.md", ID)).toBe("ref/test.md");
    expect(normalizeArtifactRel("report.html", ID)).toBe("report.html");
  });

  it("strips the <id>/artifact/ prefix from a legacy absolute entry", () => {
    expect(normalizeArtifactRel(`/home/u/.glyph/ws/tasks/${ID}/artifact/ref/test.md`, ID)).toBe(
      "ref/test.md",
    );
  });

  it("normalizes Windows separators in a legacy absolute entry", () => {
    expect(normalizeArtifactRel(`C:\\ws\\tasks\\${ID}\\artifact\\ref\\test.md`, ID)).toBe(
      "ref/test.md",
    );
  });
});
