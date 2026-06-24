/**
 * `glyph catalog ...` -- wraps the workspace-scoped catalog HTTP surface.
 *
 * Three resource families behind one parent command:
 *  - `skill {list, resolve, show, install, rm, sync-resolve, sync, ack-prereqs}`
 *  - `agent {list, resolve, show, install, rm, sync-resolve, sync, ack-prereqs, enable, disable}`
 *  - `mcp   {list, show, install, rm, sync-resolve, sync}`
 *
 * Plus `catalog overview` for the per-workspace counts. Each exported
 * function maps 1:1 to a `ROUTES` manifest entry.
 *
 * Facade: one cohesive sub-concern per sibling module under `./catalog/`
 * (`overview`, `skill`, `agent`, `mcp`); the shared `--url` / `--file`
 * install-source helper lives in `./catalog/_helpers.ts`. Commander
 * wiring stays in `../registrars/catalog.ts`.
 */

export * from "./catalog/agent.js";
export * from "./catalog/mcp.js";
export * from "./catalog/overview.js";
export * from "./catalog/skill.js";
