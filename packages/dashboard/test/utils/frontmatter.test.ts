import { describe, expect, it } from "vitest";
import { stripFrontmatter, stripHtmlComments } from "../../src/utils/frontmatter.js";

describe("stripFrontmatter", () => {
  it("returns body unchanged when no frontmatter present", () => {
    const content = "# Hello\n\nWorld";
    const result = stripFrontmatter(content);
    expect(result.data).toBeNull();
    expect(result.rawYaml).toBeNull();
    expect(result.body).toBe(content);
  });

  it("extracts valid YAML frontmatter", () => {
    const content = "---\nname: test-skill\nversion: 1.0.0\n---\n# Body\n";
    const result = stripFrontmatter(content);
    expect(result.data).toEqual({ name: "test-skill", version: "1.0.0" });
    expect(result.rawYaml).toBe("name: test-skill\nversion: 1.0.0");
    expect(result.body).toBe("# Body\n");
  });

  it("handles nested YAML objects", () => {
    const content =
      "---\ndependencies:\n  skills:\n    - skill-a\n    - skill-b\n---\nContent here";
    const result = stripFrontmatter(content);
    expect(result.data).toEqual({
      dependencies: { skills: ["skill-a", "skill-b"] },
    });
    expect(result.body).toBe("Content here");
  });

  it("returns rawYaml on parse failure", () => {
    const content = "---\n: invalid: yaml: [broken\n---\nBody";
    const result = stripFrontmatter(content);
    expect(result.data).toBeNull();
    expect(result.rawYaml).toBe(": invalid: yaml: [broken");
    expect(result.body).toBe("Body");
  });

  it("does not detect frontmatter with leading whitespace", () => {
    const content = " ---\nname: test\n---\nBody";
    const result = stripFrontmatter(content);
    expect(result.data).toBeNull();
    expect(result.body).toBe(content);
  });

  it("does not detect frontmatter without closing delimiter", () => {
    const content = "---\nname: test\nno closing marker";
    const result = stripFrontmatter(content);
    expect(result.data).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\nname: test\r\n---\r\nBody text";
    const result = stripFrontmatter(content);
    expect(result.data).toEqual({ name: "test" });
    expect(result.body).toBe("Body text");
  });

  it("returns null data for non-object YAML (e.g. scalar)", () => {
    const content = "---\njust a string\n---\nBody";
    const result = stripFrontmatter(content);
    expect(result.data).toBeNull();
    expect(result.rawYaml).toBe("just a string");
    expect(result.body).toBe("Body");
  });
});

describe("stripHtmlComments", () => {
  it("removes single-line comments", () => {
    const source = "Hello <!-- comment --> World";
    expect(stripHtmlComments(source)).toBe("Hello  World");
  });

  it("removes multi-line comments", () => {
    const source = "Before\n<!-- multi\nline\ncomment -->\nAfter";
    expect(stripHtmlComments(source)).toBe("Before\n\nAfter");
  });

  it("removes multiple comments", () => {
    const source = "<!-- a -->Hello<!-- b --> World<!-- c -->";
    expect(stripHtmlComments(source)).toBe("Hello World");
  });

  it("handles no comments gracefully", () => {
    const source = "No comments here";
    expect(stripHtmlComments(source)).toBe("No comments here");
  });

  it("handles comments at start and end", () => {
    const source = "<!-- header -->\n# Title\n<!-- footer -->";
    expect(stripHtmlComments(source)).toBe("\n# Title\n");
  });
});
