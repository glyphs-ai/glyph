import { createReadStream } from "node:fs";
import { basename } from "node:path";

/**
 * Options for {@link streamFileAsResponse}. `cacheControl` is required
 * (not defaulted) because the two artifact byte routes compute very
 * different policies -- per-request `no-store` while a task is still
 * running vs. a long `max-age` once it is terminal -- and a silent
 * default would hide that decision at the call site.
 */
export interface StreamFileOptions {
  readonly contentType: string;
  readonly cacheControl: string;
}

/**
 * Stream a file from disk as a 200 `Response`. Hono's body adapter
 * accepts any web `ReadableStream`, so the Node read stream is wrapped in
 * one to get back-pressure on slow clients; a client disconnect runs
 * `cancel` and tears down the fs handle. The inline `Content-Disposition`
 * filename is derived from the path basename and percent-encoded.
 *
 * Shared by the task- and workflow-artifact byte routes, which differ
 * only in content type and cache policy.
 */
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
