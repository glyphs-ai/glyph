---
name: agency-role-reference
scope: official
description: "Pointer index for ~185 abstract role templates (msitarzewski/agency-agents, MIT). Use as starting points when hiring a specialist — never install directly."
version: 0.1.0
---

# Agency Role Reference Skill

A pointer library of abstract role templates spanning engineering, design, product, marketing, sales, finance, project management, support, testing, game development, spatial computing, and many other domains. The templates live in the upstream [`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents) repo (MIT-licensed); this skill ships only the **index** — full template bodies are fetched on demand at hire time.

## Why this is a reference, not a catalog

The upstream repo is a library of **role descriptions** ("Frontend Developer", "Code Reviewer", "Incident Response Commander") — not ready-to-spawn agents. Each template describes a generic role's mission, rules, workflow, and success metrics in the abstract. Three reasons this skill is pointer-only, not a fork:

- **No redistribution overhead.** Pointers carry zero license-tracking friction; we never have to mirror updates from upstream.
- **Always fresh.** When upstream improves a template, the next hire that consults it gets the improvement automatically.
- **Specialization beats templating.** A template hardened for "your mission" will outperform a generic copy 9 times out of 10. The point of the index is to give the hiring agent a head start, not a finished hire.

## When to use

You're about to create a local agent — the "Create local" branch of the hiring decision tree. Before drafting from scratch:

1. Read the index — `<SKILL_DIR>/references/index.md` (~77KB; `<SKILL_DIR>` is the directory containing this `SKILL.md`, resolve from your runtime context).
2. Pick the row(s) whose description is closest to the work.
3. Fetch the upstream template body on demand:
   ```sh
   curl -sL <upstream-url-from-the-index> > /tmp/role.md
   ```
4. Read the template, extract the parts that fit:
   - **Mission / Core responsibilities** — the abstract job description
   - **Critical rules** — load-bearing constraints the role usually enforces
   - **Workflow process** — typical step sequencing
   - **Success metrics** — verifiable outcomes
5. **Specialize for the mission**:
   - Replace generic stack references with your actual stack (e.g. "React" → "React 19 + Vite + Tailwind v4")
   - Add your team's conventions (commit style, test framework, code-review etiquette)
   - Tighten success metrics to your acceptance criteria (e.g. "Lighthouse 90+" → "Lighthouse 95+ on `/dashboard` route")
   - Drop sections that don't apply (some templates assume tooling you don't use)
6. Write the result to `<workspace>/local-agents/<name>/AGENTS.md` using the glyph schema (frontmatter, required body sections — see the `meta-agent-schema` skill).
7. Install via `file://` origin and run a probe task before adding to the roster.

The `<SKILL_DIR>` placeholder convention is runtime-agnostic on purpose, so this skill ships zero coupling to any specific runtime's on-disk layout.

## What NOT to do

- **Don't install the upstream file as-is.** The schema is different (no `scope:`, no `version:`, no glyph body section requirements). Install would fail the validator; even if it didn't, you'd ship a generic agent into your mission-specific workspace.
- **Don't copy the upstream body verbatim into your local agent.** That defeats the specialization step — and pulls in Claude-Code-specific phrasing (`"Activate Frontend Developer mode"`, etc.) that doesn't match glyph's runtime.
- **Don't browse the index for inspiration unrelated to a hiring decision.** This isn't a learning library; it's a tool to make the next hire better. If you're idle-reflecting, your own `.pilot/hires.md` and `.pilot/lessons.md` are richer signal.

## When the upstream is unreachable

`curl` failed, GitHub is down, or you're working offline (rare but possible). Fall back to:

1. The role's **one-line description in `<SKILL_DIR>/references/index.md`** — often enough to seed a draft.
2. Your own past hires for adjacent roles (`.pilot/hires.md`).
3. The `writing-good-agent-prompts.md` reference in the pilot agent (general patterns by role type).

Don't block hiring on upstream availability. The index alone is enough to start.

## Index layout

`references/index.md` groups roles into 16 categories matching the upstream repo's top-level directory structure:

- **Engineering** (~29 roles) — backend, frontend, mobile, AI, DevOps, SRE, security, embedded, smart contracts, ...
- **Design** (8) — UI, UX, brand, visual storytelling, accessibility-focused visuals, ...
- **Product** (5) — PM, behavioral nudge, feedback synthesis, sprint planning, trend research
- **Project Management** (6) — Jira workflow, project shepherd, studio operations, senior PM, ...
- **Marketing** (29) — channel-specific (TikTok, LinkedIn, Reddit, ...), regional (China, cross-border), generic strategy/SEO/content
- **Paid Media** (7) — PPC, paid social, programmatic, tracking, ...
- **Sales** (8) — pipeline, deal strategy, discovery, sales engineering, ...
- **Support** (6) — analytics, finance tracking, infra, legal compliance, ...
- **Testing** (8) — accessibility, API, performance, reality-check, evidence collection, ...
- **Finance** (5) — bookkeeping, FP&A, investment research, tax, ...
- **Academic** (5) — anthropology, geography, history, narratology, psychology
- **Game Development** (19) — engine-specific (Unity, Unreal, Godot, Roblox), Blender, audio, narrative, ...
- **Integrations** (1) — backend-architect-with-memory (others are READMEs, not roles)
- **Spatial Computing** (6) — visionOS, macOS Metal, XR cockpit / interface / immersive
- **Specialized** (40+) — verticals (healthcare, legal, real estate, hospitality), governance, identity, document generation, salesforce, supply chain, ...

Each row has: role name, one-line description, upstream raw URL.

## Attribution and license

The upstream library is licensed [MIT](https://github.com/msitarzewski/agency-agents/blob/main/LICENSE) and copyrighted by its maintainer(s). This skill carries pointers only, so MIT's redistribution clauses don't strictly apply — but the work deserves credit either way. Keep this attribution in place if you fork the skill.

If a future change to this skill copies any content verbatim from upstream (we currently don't), the LICENSE file from upstream must travel with that content.

## Refreshing the index when upstream evolves

The index is a static snapshot of upstream's frontmatter, regenerated by hand. To refresh: walk the upstream repo's tree (e.g. via GitHub's `git/trees?recursive=1` API), pull each `*.md` file's YAML frontmatter, and rewrite `references/index.md` with one row per role grouped by top-level category. The header comment in `references/index.md` documents the format the index file follows. Open a PR with just the refreshed `index.md`; no other files need to change unless upstream introduces a new category dir.
