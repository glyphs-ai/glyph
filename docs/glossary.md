# Glossary

One-line definitions for the domain terms glyph's docs and code use
without restating. Each entry links the canonical implementation or
explanation site. Alphabetical.

### coordinator (workflow node kind)

A workflow node backed by a long-running coordinator agent that is
allowed to mutate its own DAG - adding nodes and edges as the work
unfolds. Its spec is validated by `WorkflowCoordSpecError`
(`packages/api/src/wiring/workflow-coord-task-runner.ts`). See also
**worker**, **human**.

### facade

A `<basename>.ts` file that re-exports the public surface of a sibling
`<basename>/` subdirectory, so a package can split a large module across
several files while keeping a single import path. The convention and its
hard rules live in
[`pkg-template.md` -> Splitting big files](./pkg-template.md#splitting-big-files-via-facade--sibling-subdir).

### human (workflow node kind)

A workflow node that pauses the DAG until a person answers it through
`POST /api/workspaces/:id/workflows/:wfid/nodes/:nid/respond`. Its spec
is validated by `WorkflowHumanSpecError`
(`packages/api/src/wiring/workflow-human-node-runner.ts`). See also
**coordinator**, **worker**.

### kind

An overloaded discriminator - read the context:
- **URL-implied kind**: a schedule/route target type (`task` vs
  `workflow`) implied by the URL segment; the request body may not
  restate it (`packages/server/src/routes/schedules.ts`).
- **node kind**: a workflow node's role (`coordinator` / `worker` /
  `human`); see those entries.

### metadata_key (a.k.a. metadataKey)

The stable string key under an entity's `metadata` that the origin index
looks up - for example `scheduleId` on a schedule-launched task. Paired
with **origin** to form the `(origin, metadataKey)` cascade index that
gates schedule deletion. See also **origin**.

### mode

One of glyph's three execution modes - interactive `session`, headless
one-shot `task`, and multi-task `workflow` (a DAG). The three are the T1
tier; see [`architecture.md` -> Tier model](./architecture.md#tier-model).

### origin

The writer's identity tag stamped on a Task or Workflow row, recording
which subsystem created it - one of `standalone`, `workflow`, or
`schedule` for a Task (`packages/task/src/types.ts`), and only
`standalone` or `schedule` for a Workflow
(`packages/workflow/src/types.ts`). Paired with **metadata_key** for the
indexed-lookup cascade (a schedule delete prunes terminal rows that
carry its `(origin, metadataKey)` pair; in flight rows block the
delete). Distinct from a catalog entry's `origin`, which is the source
URI (GitHub tree, Azure DevOps, or `file:`) identifying a skill / agent
/ MCP (`packages/catalog/src/validate.ts`) - a separate concept.

### runtimeSessionId

The id a **runtime** adapter assigns to a provisioned conversation.
Pre-allocating runtimes return a fresh UUID from `provision`;
discovery-only runtimes return `null` and learn the id later via a
discovery hook (`packages/runtime/src/types.ts`).

### substrate

The T0 data layer a higher tier operates on, kept distinct from the
service/engine that drives it - e.g. the `workflows` /
`workflow_nodes` / `workflow_edges` SQLite tables are the workflow
*substrate*, separate from the T1 `WorkflowService` that mutates them.

### tier / T0..T_top

glyph's 5-tier model describing *what kind of thing* a package is: **T0**
foundations, **T1** modes, **T2** application, **T3** host, **T_top**
surfaces. The canonical table is
[`architecture.md` -> Tier model](./architecture.md#tier-model); the
import fence is enforced by
`packages/e2e/test/architecture/tier-invisibility.test.ts`.

### wire

The marker on a DTO that crosses the HTTP boundary (often a `Wire`
suffix, e.g. `WorkflowNodeKindWire`). Wire types are owned by
[`@glyphs-ai/contracts`](../packages/contracts) and shared by `api`,
`server`, `cli`, and `dashboard` without any of them importing each
other's internals.

### worker (workflow node kind)

A workflow node that runs a single headless task (an agent plus a brief).
Its spec is validated by `WorkflowWorkerSpecError`
(`packages/api/src/wiring/workflow-worker-task-runner.ts`). See also
**coordinator**, **human**.

### wsid

A workspace id - the opaque UUID that identifies a workspace in API URLs
(`/api/workspaces/<wsid>/...`). Stable for the lifetime of the registry
entry, so dashboard URLs survive workspace renames.
