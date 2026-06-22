/** Extension-to-category mapping for the catalog file browser. */

export type FileCategory = "markdown" | "code" | "image" | "plain" | "binary";

/**
 * Supported CodeMirror language modes. The dashboard's CodeEditor only
 * bundles markdown, yaml, and json — files with other code extensions
 * are rendered as plain text to avoid misleading highlighting.
 */
export type CodeLanguage = "markdown" | "yaml" | "json";

const MARKDOWN_EXTS = new Set([".md"]);

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sh",
  ".bash",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".rb",
  ".lua",
  ".sql",
  ".graphql",
  ".proto",
]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"]);

const PLAIN_EXTS = new Set([
  ".txt",
  ".log",
  ".csv",
  ".env",
  ".gitignore",
  ".editorconfig",
  ".dockerignore",
]);

function extOf(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * Categorize a file by its extension. Falls back to "plain" for unknown
 * text-looking extensions or "binary" for known non-text types.
 */
export function categorize(relPath: string): FileCategory {
  const ext = extOf(relPath);
  if (!ext) return "plain";
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (CODE_EXTS.has(ext)) return "code";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PLAIN_EXTS.has(ext)) return "plain";
  return "plain";
}

/**
 * For code files that CodeEditor can syntax-highlight, return the
 * appropriate language mode. Returns `null` for extensions CodeEditor
 * does not support — callers should render those as plain `<pre>`.
 */
export function codeLanguage(relPath: string): CodeLanguage | null {
  const ext = extOf(relPath);
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".md") return "markdown";
  return null;
}

/**
 * Binary detection heuristic: checks for null bytes in the first 512
 * bytes of an ArrayBuffer. Matches Git's heuristic.
 */
export function isBinary(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512));
  for (let i = 0; i < view.length; i++) {
    if (view[i] === 0) return true;
  }
  return false;
}

/**
 * Determine the final rendering category taking both extension and
 * content into account. If the extension suggests text but the content
 * has null bytes, fall back to binary.
 */
export function categorizeWithContent(relPath: string, buffer: ArrayBuffer): FileCategory {
  const ext = categorize(relPath);
  if (ext === "image" || ext === "binary") return ext;
  if (isBinary(buffer)) return "binary";
  return ext;
}
