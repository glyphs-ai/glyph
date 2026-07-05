/**
 * Shared `--url` / `--file` install-source handling for the catalog
 * `skill` / `agent` / `mcp` install + resolve commands. One spelling of
 * the mutually-exclusive source pair, consumed by all three families.
 */

/**
 * Mutually-exclusive `--url <value>` / `--file <path>` flag pair shared
 * by every catalog install / resolve command. The user picks ONE; the
 * CLI assembles the canonical wire origin via {@link buildInstallOrigin}.
 */
export interface InstallSourceFlags {
  readonly url?: string;
  readonly file?: string;
}

/**
 * Build the canonical wire origin from the CLI's `--url` / `--file` flags.
 *
 * Exactly one flag must be set. Returns either:
 *  - `{ origin }` -- ready for the wire payload, OR
 *  - `{ error }`  -- a human-readable message for stderr (exit code 2).
 *
 * Rules:
 *  - `--url <value>` is pass-through (the server's `parseOrigin` picks the
 *    fetcher from the URL grammar; today only `https://github.com/...` is
 *    accepted, with `parseOrigin` returning a clear "unsupported scheme"
 *    error otherwise).
 *  - `--file <path>` prepends `file:` if not already prefixed (tolerates
 *    paste of `file:/abs/x`).
 *  - `--url file:...` is rejected -- picking URL with a `file:` URI is a
 *    misuse. Suggest `--file` instead.
 *  - Neither flag, both flags -> usage error listing both.
 *  - Whitespace-only flag values are treated as missing.
 *
 * Mirror lives in `packages/dashboard/src/api/catalog.ts`
 * (`buildOriginFromSource`) so the same shape is rejected at both
 * client-input boundaries.
 */
export function buildInstallOrigin(
  opts: InstallSourceFlags,
): { origin: string } | { error: string } {
  const url = typeof opts.url === "string" ? opts.url.trim() : "";
  const file = typeof opts.file === "string" ? opts.file.trim() : "";
  if (url === "" && file === "") {
    return { error: "must provide --url <value> or --file <path>" };
  }
  if (url !== "" && file !== "") {
    return { error: "cannot provide both --url and --file; pick one" };
  }
  if (url !== "") {
    if (url.startsWith("file:")) {
      return { error: 'URL source cannot be a "file:" URI; use --file <path> instead' };
    }
    return { origin: url };
  }
  return { origin: file.startsWith("file:") ? file : `file:${file}` };
}

/**
 * Split a catalog resource FQN into its `{scope}/{name}` path segments.
 *
 * Catalog resources are addressed by a two-segment `{scope}/{name}`
 * route (e.g. `official/git-pr`). The FQN carries exactly one slash
 * separating the scope from the short name; split on that first slash so
 * each half can be passed as a discrete typed `path` param to the
 * generated SDK ops (which percent-encode each segment individually).
 */
export function splitCatalogFqn(fqn: string): { scope: string; name: string } {
  const slash = fqn.indexOf("/");
  if (slash === -1) {
    return { scope: fqn, name: "" };
  }
  return { scope: fqn.slice(0, slash), name: fqn.slice(slash + 1) };
}
