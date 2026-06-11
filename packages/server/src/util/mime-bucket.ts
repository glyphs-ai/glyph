import path from "node:path";
import type { WorkflowArtifactMimeBucket } from "@glyphs-ai/api";

/**
 * Single source of truth for the workflow-artifacts MIME bucket
 * detection. Returns one of `"text" | "image" | "archive" |
 * "generic"` based on the filename's extension, lowercased. The
 * dashboard's Artifacts tab uses the bucket to pick an icon
 * (📄 / 🖼️ / 📦 / 📎) without sniffing the bytes.
 *
 * Server-side because the bucket is a presentation hint computed
 * from filesystem state; contracts is wire-shapes-only by
 * convention. Keep the extension lists in sync with the dashboard's
 * artifact UI.
 *
 * Hidden / extensionless files fall through to "generic". An
 * unknown extension also yields "generic" — the dashboard renders
 * a download-style link for that bucket.
 */
export function mimeBucketFor(filename: string): WorkflowArtifactMimeBucket {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (ext === "") return "generic";
  if (TEXT_EXTS.has(ext)) return "text";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  return "generic";
}

export function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  switch (ext) {
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "md":
      return "text/markdown; charset=utf-8";
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

const TEXT_EXTS = new Set([
  "md",
  "txt",
  "json",
  "yaml",
  "yml",
  "log",
  "csv",
  "tsv",
  "html",
  "htm",
  "xml",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "go",
  "rs",
  "sh",
  "ps1",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);

const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]);
