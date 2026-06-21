# first-party — Glyph's bundled catalog

This directory ships the agents, skills, and MCPs that the glyph project itself maintains in lock-step with the codebase. Entries here use `scope: official`.

## Why is this in the main repo?

These entries depend on glyph internals (CLI surface, agent frontmatter schema, runtime contracts) tightly enough that they should version-bump and PR together with the code that defines those internals. Living in `packages/`'s neighbor `first-party/` lets schema changes land atomically with corresponding entry updates.

Third-party catalogs are installed exactly the same way — point `glyph catalog ... install --url` at any reachable GitHub URL.

## Install

Use any of:

```
glyph catalog agent install --url https://github.com/glyphs-ai/glyph/tree/main/first-party/agents/engineer
glyph catalog skill install --url https://github.com/glyphs-ai/glyph/tree/main/first-party/skills/cli
```

The glyph dashboard's "Install from URL" field also accepts these.

## Contents

### Agents

- `official/pilot` — long-lived workspace orchestrator (recommended starting point for new workspaces)
- `official/engineer` — implements features and fixes for glyph itself
- `official/designer` — frontend design specs + Playwright-driven design review for `packages/dashboard`
- `official/reviewer` — code review and full-repo audits against the glyph codebase
- `official/coordinator` — workflow DAG orchestrator (wakes on state changes, dispatches workers per strategy skill)

### Skills

- `official/cli` — glyph CLI command reference (workspace, agent, task, session, catalog subcommands)
- `official/workflow-coordination` — generic coordinator framework (DAG reading, verdict schema, worker brief plumbing); loaded by the `official/coordinator` agent
- `official/software-development-lifecycle` — engineer → review+designer iterate-to-clean strategy (loaded by `official/coordinator`)
- `official/dispatch-watchdog` — script + pattern for blocking on a long-running task
- `official/dispatch-with-details` — pattern for dispatching tasks with structured detail bodies
- `official/git-pr` — git branch management and GitHub PR workflow using worktrees
- `official/meta-agent-schema` — authoritative frontmatter/layout schema for catalog entries (loaded by `official/pilot` for hiring and `official/reviewer` for catalog-PR cross-check)
- `official/agency-role-reference` — index of ~185 abstract role templates for pilot's create-local hiring path
- `official/karpathy-guidelines` — Karpathy's behavioral guidelines for engineering agents
- `official/thermo-nuclear-code-quality-review` — extreme-scrutiny code-quality review heuristics
- `official/cjk-pdf-report` — render a self-contained HTML report to a CJK-safe PDF (Chromium print with the browser footer stripped, a five-point pypdf self-check, and a white-background design system)

## Schema

See the [`official/meta-agent-schema`](./skills/meta-agent-schema/SKILL.md) skill for the authoritative rules: frontmatter shape, MCP cross-platform constraints, dependency origins, and conventions third-party catalogs are expected to follow as well.

