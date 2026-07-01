import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";

export interface StreamFileOptions {
  readonly contentType: string;
  readonly cacheControl: string;
}

export function streamFileAsResponse(absPath: string, options: StreamFileOptions): Response {
  const name = basename(absPath);
  const node = createReadStream(absPath);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => {
        const buf =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        controller.enqueue(buf);
      });
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": options.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
      "Cache-Control": options.cacheControl,
    },
  });
}

export function contentTypeFor(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase();
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
