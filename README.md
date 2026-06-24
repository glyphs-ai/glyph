# Glyph

[![npm version](https://img.shields.io/npm/v/@glyphs-ai/glyph.svg)](https://www.npmjs.com/package/@glyphs-ai/glyph)
[![CI](https://github.com/glyphs-ai/glyph/actions/workflows/ci.yml/badge.svg)](https://github.com/glyphs-ai/glyph/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A glyph is the visible form of an idea. In typography, the *character* is
abstract; the *glyph* is how that character is rendered in a particular
font, weight, and context. The character is the meaning; glyphs are the
forms it takes.

We believe intelligence works the same way. Intent, reasoning, memory,
and collaboration are the abstractions. What we actually touch — models,
prompts, agents, tools, workflows — are their current glyphs. Those
forms will keep changing. The abstractions beneath them won't.

Glyph the project is a workbench for exploring, composing, and evolving
those forms, while staying independent of any particular implementation
or era of AI. The future of intelligence is unlikely to be written in
today's language — we're still learning its alphabet.

> **Pre-1.0 — APIs may change.** Targeted at solo developers and small teams
> running glyph against their own machine; multi-user deployment is not yet
> a goal.

## Quickstart

Requires Node 22+.

```sh
npm install -g @glyphs-ai/glyph
glyph start
```

Then open <http://127.0.0.1:8787> in your browser. `glyph start` runs the
server as a detached background process so the terminal is free; the rest
of the lifecycle is `glyph stop`, `glyph restart`, `glyph status`,
and `glyph logs -f`. Run `glyph help` (or just `glyph`) for the full
command tree, or `glyph serve` to keep it in the foreground (the legacy
behaviour, useful for `tmux` panes or `systemd` units).

The first time you run `glyph`, the dashboard's landing page is empty.
Walk through:

1. **Add a workspace** — give it a display name. Optionally pick a directory
   on disk; if you don't, glyph creates one under
   `$GLYPH_HOME/workspaces/<uuid>/` so the workspace id and the on-disk
   directory share the same name. Either way glyph writes
   a `workspace.db` SQLite file plus `sessions/` and `tasks/` subdirs
   inside; existing files in a user-supplied directory are left alone.
2. **Install an agent** in the Catalog tab — point at any directory containing
   an `AGENTS.md` (a [Claude-style agent](https://www.claude.com/news/agent-skills);
   any directory with valid frontmatter works). Skills + MCPs the agent
   depends on go in the same way.
3. **Dispatch a task** in the Tasks tab — pick the agent, write a brief
   (one-line goal) and optional details, click *Dispatch*. The agent runs
   unattended in a new sandbox under
   `tasks/<id>/`; the dashboard shows the live event stream and folds the
   exit into a final `succeeded` / `failed` / `cancelled` status.
4. **Or open a session** in the Sessions tab — interactive workdir; glyph
   bakes the agent into it and gives you the exact `copilot` invocation to
   run yourself.

## Install from GitHub Release tarball

Use this when you can't install from the public npm registry (private
network policy, no mirror, etc.). Requires Node 22+ and npm. Every
tagged release on this repo attaches the same `.tgz` that gets pushed
to npm as a downloadable asset.

`npm install` accepts an HTTPS URL directly — no local download step:

```sh
npm install -g https://github.com/glyphs-ai/glyph/releases/download/vX.Y.Z/glyphs-ai-glyph-X.Y.Z.tgz
```

Substitute `X.Y.Z` (twice — in the tag and in the filename) for the
target release version. npm fetches over HTTPS and installs in one
step; nothing is written to the current working directory.

The tarball filename follows npm's scoped-package slugification —
`@glyphs-ai/glyph` becomes `glyphs-ai-glyph-X.Y.Z.tgz` (the leading
`@` and the `/` collapse to `-`).

## Configuration

All configuration is via environment variables; no config file. Defaults
work for single-machine use; only set what you need to override.

| Env var              | Default        | Purpose                                                                                                  |
| -------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `PORT`               | `8787`         | HTTP listen port.                                                                                        |
| `GLYPH_HOST`       | `127.0.0.1`    | Bind address. glyph is **loopback-only** — non-loopback values are refused at startup. For remote access, expose the loopback socket through SSH port-forward, a reverse proxy (mTLS / OIDC), or a mesh VPN (Tailscale, …). |
| `GLYPH_HOME`       | `~/.glyph`   | Where the global SQLite registry (`global.db`) lives.                                                  |
| `GLYPH_LOG_LEVEL`  | `info`         | `trace` / `debug` / `info` / `warn` / `error` / `fatal` (pino's level set).                              |
| `GLYPH_LOG_FORMAT` | `pretty`       | `pretty` (dev terminal) or `json` (log aggregators).                                                     |
| `GLYPH_STATIC_DIR` | next to bundle | Override the dashboard SPA location. Useful when running from a non-bundle layout.                       |

Pass `--no-serve-static` to run API-only (the dashboard SPA is bundled in
the npm package by default; serving it from the same port is the only
deployment mode that makes sense for the local-first model).

## Filesystem contract

Everything glyph writes under `<GLYPH_HOME>` (default `~/.glyph`)
and per-workspace internals is **server-internal state**. The layout —
file names, JSON shapes, SQLite schemas, sidecar files — is implementation
detail and may change between versions. Reading these files for inspection
is fine; **anything else (writes, hand-edits, `rm`) is unsupported and
may be detected as corruption.**

For the path-by-path layout (what glyph owns vs the agent vs the
runtime adapter) and the rationale for keeping clients out of
`<GLYPH_HOME>/`, see [`docs/architecture.md` →
Filesystem contract](./docs/architecture.md#filesystem-contract).

## CLI

After `npm install -g @glyphs-ai/glyph` the `glyph` binary exposes
two layers of commands:

### Lifecycle (talk to the local process)

| Command            | Behaviour                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glyph`          | Print top-level help (alias for `glyph help`).                                                                                                                         |
| `glyph help [c]` | Top-level help, or per-subcommand help when `c` is given.                                                                                                                |
| `glyph serve`    | Run the server in the foreground — current dev behaviour. Honours every env var in the *Configuration* table; flags override env.                                        |
| `glyph start`    | Spawn the server as a detached background process. Records pid + port in `<GLYPH_HOME>/runtime.json`. Idempotent.       |
| `glyph stop`     | SIGTERM the recorded pid, wait for graceful shutdown (escalates to SIGKILL after 30 s), then delete `runtime.json`. Idempotent. *Windows note:* `process.kill` maps to `TerminateProcess` — there is no graceful equivalent on Windows; the server's atomic-write persistence keeps state consistent regardless. |
| `glyph restart`  | `stop` then `start` with the same flags.                                                                                                                                 |
| `glyph status`   | Print one-line health summary. Exit codes: `0` running + healthy, `3` not running, `4` running but `/api/health` not responding. `--json` for scripts.                   |
| `glyph logs`     | Cat the rolling server log under `<GLYPH_HOME>/logs/`. `-f` follows the file as it grows (Ctrl-C to stop).                                                             |

### API client (talk to a running server)

Every typed route — wrapped 1:1 by the CLI's `client.call(...)` surface;
the typed manifest in `packages/contracts/src/routes.ts` is the single
source of truth that both the server registers handlers against and
the CLI builds typed calls from. Adding a route on either side
without updating the other fails CI.

```sh
# server connection (default: http://127.0.0.1:8787, picked up from
# `runtime.json` when `glyph start` has run)
glyph health
glyph config --json
glyph runtime list

# workspaces
glyph workspace list
glyph workspace add --name "Sandbox" --workspace-dir ~/code/sandbox
export GLYPH_WORKSPACE=<id>          # required for workspace-scoped commands
glyph workspace show <workspace-id>
glyph workspace rm <workspace-id> --purge

# sessions and tasks (workspace-scoped; pass --workspace-id <id> to override the env above)
glyph session new --agent writer
glyph session list --agent writer --json
glyph task dispatch --agent triage --brief "Scan recent issues"
glyph task list --status running,succeeded
glyph task activity <tid>   # runtime-parsed activity timeline (JSON)

# catalog
glyph catalog overview
glyph catalog skill list
glyph catalog skill install --file /abs/path/to/skill
glyph catalog agent install --url https://github.com/glyphs-ai/glyph/tree/main/first-party/agents/engineer
glyph catalog mcp install --url https://github.com/glyphs-ai/glyph/tree/main/first-party/mcps/io.playwright_mcp.json

# schedules (workspace-scoped cron triggers)
glyph schedule list
glyph schedule create --name "Nightly scan" --agent triage --brief "Scan recent issues" --cron "0 3 * * *" --tz UTC
```

Common flags on every API command:

- `--server <url>` — overrides `GLYPH_SERVER` and `runtime.json`. Defaults to `http://127.0.0.1:8787`.
- `--workspace-id <id>` — workspace-scoped commands. Overrides `GLYPH_WORKSPACE` and the server's `currentWorkspace`.
- `--output <fmt>` / `--json` — `table` (human-friendly default) or `json` (for scripting).

Exit codes: `0` success, `1` generic error, `2` usage error, `3` server unreachable, `4` server returned a 4xx/5xx.

## Where this sits

Glyph does not invent a new agent format — it adopts the
[MetaAgents](https://github.com/metaagents-ai/metaagents) Layer-0 spec where
agents are markdown files (`AGENTS.md`) with YAML frontmatter, skills are
markdown files (`SKILL.md`) with YAML frontmatter, and MCPs are JSON config
blobs. What glyph adds:

- **A dependency-aware catalog** — agents declare which skills + MCPs they
  need; glyph topologically resolves them, blocks cycles, and refuses to
  uninstall something another entry depends on.
- **A workspace abstraction** — multiple isolated projects on one machine;
  each picks its own agent set without polluting the others.
- **Runtime adapters** — first-class support for the
  [GitHub Copilot CLI](https://github.com/github/copilot-cli) today; the same
  surface lets future runtimes (Gemini, Claude Code, …) drop in.
- **Three execution modes** — interactive `session`, one-shot `task`, and
  multi-task `workflow` (a DAG of sessions and tasks coordinated by a
  long-running coordinator agent). All three persist across server
  restarts and share a structured `running → succeeded/failed/cancelled`
  lifecycle.

## Architecture

Glyph is a pnpm monorepo with strict tier-based layering. The design
contract — repository pattern, atomic-write seam, REST URL scheme,
package boundaries — lives in [`docs/architecture.md`](./docs/architecture.md).
The conceptual model behind why glyph is shaped this way lives in the
paper [*What we believe about agentic systems*](https://glyphs-ai.github.io/glyph/);
it's a short read.

## First-party catalog

The repo ships a [`first-party/`](./first-party/) subtree of agents and
skills (scope `official`) that the project maintains in lock-step with the
code — they depend on internals (catalog schema, CLI surface) tightly
enough to version-bump and PR together with the packages that define
those internals. See [`first-party/README.md`](./first-party/README.md)
for the full list and install URLs. Third-party catalogs can be installed
the same way as first-party entries (any reachable GitHub URL).

## Development

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for the local setup,
daily loop, and "adding things" pointer map. The release procedure lives
in [`docs/RELEASING.md`](./docs/RELEASING.md).

## License

MIT — see [LICENSE](./LICENSE).
