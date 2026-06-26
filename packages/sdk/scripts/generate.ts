/**
 * SDK codegen pipeline.
 *
 * 1. Assemble the glyph OpenAPI 3.1 app in-process (no socket, no port) —
 *    the same mount tree `runServer` wires, via `buildOpenApiApp`.
 * 2. Fetch `/api/openapi.json` from it as JSON, in memory.
 * 3. Write the spec to a temp file.
 * 4. Run `@hey-api/openapi-ts` against that temp file, emitting the typed
 *    fetch client into `src/generated/`.
 * 5. Print an auditable one-line summary so PR diffs are reviewable.
 *
 * Idempotent: for a fixed input spec the generator is byte-stable, so
 * `pnpm -F @glyphs-ai/sdk gen` produces identical output across runs.
 * CI drift-checks the committed `src/generated/` against a fresh run.
 *
 * NOTE: this reaches into `@glyphs-ai/server` source (devtime only). The
 * workspace must be built first (`pnpm build`) so the server route
 * modules' own `@glyphs-ai/*` imports resolve to their `dist/`.
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";
import { buildOpenApiApp, OPENAPI_DOC_PATH } from "./build-openapi-app.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const OUTPUT_DIR = path.join(PKG_ROOT, "src", "generated");

async function dirSummary(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    const abs = path.join(entry.parentPath ?? entry.path, entry.name);
    bytes += (await stat(abs)).size;
  }
  return { files, bytes };
}

async function main(): Promise<void> {
  const app = buildOpenApiApp();
  const res = await app.request(OPENAPI_DOC_PATH);
  if (res.status !== 200) {
    throw new Error(`assembling OpenAPI doc failed: ${res.status} ${res.statusText}`);
  }
  const spec = (await res.json()) as { paths?: Record<string, unknown> };

  const operations = Object.values(spec.paths ?? {}).reduce<number>(
    (sum, item) =>
      sum +
      Object.keys(item as Record<string, unknown>).filter((k) =>
        ["get", "post", "patch", "delete", "put"].includes(k),
      ).length,
    0,
  );

  const specPath = path.join(tmpdir(), "glyph-openapi.json");
  // Pretty-print with a trailing newline so the temp artefact is itself
  // diff-friendly if a developer inspects it.
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

  await mkdir(OUTPUT_DIR, { recursive: true });
  await createClient({
    input: specPath,
    output: { path: OUTPUT_DIR, postProcess: [], indexFile: true },
    plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
    logs: { level: "silent" },
  });

  const { files, bytes } = await dirSummary(OUTPUT_DIR);
  process.stdout.write(
    `[sdk gen] ${operations} operations across ${Object.keys(spec.paths ?? {}).length} paths → ` +
      `${files} files, ${bytes} bytes in src/generated/\n`,
  );
}

await main().catch((err: unknown) => {
  process.stderr.write(`[sdk gen] failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
