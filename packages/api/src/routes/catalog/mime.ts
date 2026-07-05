const EXT_MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".bash": "text/plain; charset=utf-8",
  ".go": "text/plain; charset=utf-8",
  ".rs": "text/plain; charset=utf-8",
  ".java": "text/plain; charset=utf-8",
  ".c": "text/plain; charset=utf-8",
  ".cpp": "text/plain; charset=utf-8",
  ".h": "text/plain; charset=utf-8",
  ".rb": "text/plain; charset=utf-8",
  ".lua": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".graphql": "text/plain; charset=utf-8",
  ".proto": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".env": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
};

/**
 * Derive a Content-Type from a file's extension. Falls back to
 * `application/octet-stream` for unknown extensions.
 */
export function mimeFromExt(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = relPath.slice(dot).toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}
