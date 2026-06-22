import yaml from "js-yaml";

export interface FrontmatterResult {
  /** Parsed YAML object, or null if no frontmatter detected or parse failure. */
  data: Record<string, unknown> | null;
  /** Raw YAML string (for fallback rendering on parse failure). */
  rawYaml: string | null;
  /** Markdown body with frontmatter stripped. */
  body: string;
}

/**
 * Extract YAML frontmatter from a markdown string.
 *
 * Frontmatter is only detected when the file starts with `---\n` at byte 0
 * (no leading whitespace). The block ends at the next `---\n` or `---` at EOF.
 */
export function stripFrontmatter(content: string): FrontmatterResult {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { data: null, rawYaml: null, body: content };
  }

  const lineBreak = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const startIdx = 3 + lineBreak.length; // skip opening `---\n`
  const endMarker = `${lineBreak}---`;
  const endIdx = content.indexOf(endMarker, startIdx);

  if (endIdx === -1) {
    return { data: null, rawYaml: null, body: content };
  }

  const rawYaml = content.slice(startIdx, endIdx);
  const body = content.slice(endIdx + endMarker.length + lineBreak.length);

  let data: Record<string, unknown> | null = null;
  try {
    const parsed = yaml.load(rawYaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Parse failure — rawYaml is still available for fallback display
  }

  return { data, rawYaml, body };
}

/**
 * Strip HTML comments from markdown source.
 * Handles single-line and multi-line comments.
 */
export function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}
