import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type PlaceholderContext,
  substitutePlaceholdersDeep,
  UnknownPlaceholderError,
} from "../placeholders.js";
import type { AgentContentSource, ResolvedAgent } from "../types.js";

/** Filename of the project-level opencode config written into the workdir. */
export const OPENCODE_CONFIG_FILE = "opencode.json";

/**
 * Bake `agent` into `workdir` so `opencode` can be launched there.
 *
 * Layout produced (relative to `workdir`):
 *
 *   AGENTS.md               — copied verbatim from the resolved agent
 *   <agent siblings...>     — every other file the agent installed
 *   opencode.json           — `{ "mcp": { name: <opencode-local-config>, … } }`
 *
 * `opencode.json` is loaded by the opencode CLI as a project config when
 * launched from `workdir`. MCP entries are converted from glyph's catalog
 * wire format (`{ type: "stdio", command, args, env }`) to opencode's
 * format (`{ type: "local", command: [cmd, ...args], environment: env }`).
 *
 * Placeholder substitution (`${workspaceDir}`, `${sharedDir}`) is applied to
 * all string fields in MCP configs via {@link substitutePlaceholdersDeep}.
 *
 * opencode does not have a concept of skills equivalent to Copilot's
 * `.github/skills/` layout. Agent files (AGENTS.md and siblings) are placed
 * in the workdir root — opencode reads AGENTS.md there as project-level
 * instructions.
 */
export async function provisionOpencodeWorkdir(
  workdir: string,
  agent: ResolvedAgent,
  catalog: AgentContentSource,
  placeholders: PlaceholderContext,
): Promise<void> {
  await mkdir(workdir, { recursive: true });
  await Promise.all([
    materializeAgent(workdir, agent.agent.fqn, catalog),
    writeOpencodeConfig(workdir, agent.mcps, catalog, placeholders),
  ]);
}

/** Copy every file the agent installed verbatim into `workdir`. */
async function materializeAgent(
  workdir: string,
  agentName: string,
  catalog: AgentContentSource,
): Promise<void> {
  for await (const { relPath, content } of catalog.agentEntries(agentName)) {
    await writeFileAt(workdir, relPath, content);
  }
}

/**
 * For each MCP referenced by the agent, fetch its config from the catalog,
 * convert to opencode's MCP format, and write as `opencode.json`.
 *
 * Glyph's catalog MCP wire format (returned by `getMcpRuntimeConfig`) uses the
 * MCP protocol's stdio shape: `{ type: "stdio", command, args?, env? }`. This
 * is converted to opencode's local-server shape:
 * `{ type: "local", command: [cmd, ...args], environment: env }`.
 *
 * Placeholder substitution is applied before conversion so MCP specs can
 * reference `${workspaceDir}` and `${sharedDir}` without baking host paths.
 */
async function writeOpencodeConfig(
  workdir: string,
  mcps: readonly { readonly fqn: string }[],
  catalog: AgentContentSource,
  placeholders: PlaceholderContext,
): Promise<void> {
  if (mcps.length === 0) return;

  const mcpMap: Record<string, unknown> = {};
  for (const mcp of mcps) {
    let raw: Record<string, unknown>;
    try {
      raw = await catalog.getMcpRuntimeConfig(mcp.fqn);
    } catch (cause) {
      throw new Error(`MCP "${mcp.fqn}" config is invalid: ${(cause as Error).message}`, { cause });
    }
    let substituted: Record<string, unknown>;
    try {
      substituted = substitutePlaceholdersDeep(raw, placeholders, `mcps:${mcp.fqn}`) as Record<
        string,
        unknown
      >;
    } catch (cause) {
      if (cause instanceof UnknownPlaceholderError) {
        throw new Error(`MCP "${mcp.fqn}" config is invalid: ${cause.message}`, { cause });
      }
      throw cause;
    }
    mcpMap[mcp.fqn] = toOpencodeMcpServer(substituted);
  }

  const dest = path.join(workdir, OPENCODE_CONFIG_FILE);
  await writeFile(dest, `${JSON.stringify({ mcp: mcpMap }, null, 2)}\n`, "utf8");
}

/**
 * Convert a glyph catalog MCP config (post-`_meta`-strip) to the shape
 * opencode expects in its `opencode.json` `mcp` section.
 *
 * Glyph's catalog stores MCPs in the MCP protocol's stdio format:
 *   `{ "type": "stdio", "command": "cmd", "args": [...], "env": {...} }`
 *
 * opencode uses a different field layout for local (stdio) servers:
 *   `{ "type": "local", "command": ["cmd", ...args], "environment": {...} }`
 *
 * HTTP/remote MCPs (type absent or "http"/"sse") are passed through as-is;
 * opencode's remote-server schema overlaps with the catalog's and needs no
 * conversion for typical usage.
 */
export function toOpencodeMcpServer(config: Record<string, unknown>): Record<string, unknown> {
  if (config.type !== "stdio") {
    // Remote / HTTP MCPs — pass through without conversion.
    return config;
  }

  const cmd = typeof config.command === "string" ? [config.command] : [];
  const args = Array.isArray(config.args)
    ? (config.args as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  const env =
    config.env !== null &&
    config.env !== undefined &&
    typeof config.env === "object" &&
    !Array.isArray(config.env)
      ? (config.env as Record<string, string>)
      : {};

  const server: Record<string, unknown> = {
    type: "local",
    command: [...cmd, ...args],
  };
  if (Object.keys(env).length > 0) {
    server.environment = env;
  }
  return server;
}

/**
 * Write `content` to `<destRoot>/<relPath>`, creating intermediate dirs.
 * `relPath` is POSIX-style; `path.join` normalises for the host OS.
 * Validates that the resolved path stays inside `destRoot`.
 */
async function writeFileAt(destRoot: string, relPath: string, content: Buffer): Promise<void> {
  const segments = relPath.split("/");
  const fileName = segments.pop();
  if (!fileName) return;
  const dir = segments.length > 0 ? path.join(destRoot, ...segments) : destRoot;
  const target = path.join(dir, fileName);
  const resolvedDest = path.resolve(target);
  const resolvedRoot = path.resolve(destRoot);
  if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(resolvedRoot + path.sep)) {
    throw new Error(
      `refusing to write catalog entry outside workdir: relPath ${JSON.stringify(relPath)} resolves to ${resolvedDest}`,
    );
  }
  if (segments.length > 0) await mkdir(dir, { recursive: true });
  await writeFile(target, content);
}
