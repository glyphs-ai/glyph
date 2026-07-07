# Changelog

## 0.4.4 (2026-07-07)

- Make the `next-coord` coord-parent requirement explicit in §B. The prior `add-subgraph` JSON template omitted `existingParents` on the `next-coord` node, which read as "the intra-batch edges from workers are the only wiring needed." The domain invariant (`enforceCoordChainInvariants`) actually requires the new coord node to have at least one coord-kind parent: workers-only parents are rejected with `WorkflowDagConflict / orphanCoordInsert`. The template now sets `existingParents: ["<self-node-id>"]` on the coord node, the surrounding prose grew from two universal rules to three (rule 3 states the coord-to-coord chain explicitly and calls out that the resulting mixed-parents shape drives the phase computation), and a new `Common add-subgraph rejections` sub-section maps every `WorkflowDagConflict.reason.kind` (`orphanCoordInsert`, `successorCoordExists`, `parentState`, `WorkflowNodeNotMutable`, `cyclic`) to a concrete forward fix so coord can recover from a rejection in one wake-up instead of trial-and-error across many.

## 0.4.3 (2026-07-07)

- Replace remaining concrete strategy / worker / VCS names in body examples with placeholders (`<your-coord-agent-fqn>`, `<your-strategy-name>`, `<your-scope>`, generic "the agent's VCS skill"). Framework skill is now strategy-neutral end-to-end.
- Pre-flight validation § drops the alt-heading suggestion `"What I do NOT do"` — no first-party agent uses that heading; the real name is `Boundaries`.
- Strategy-skill authoring frontmatter comment simplified to `# kebab-case` (the prior `e.g. <your-strategy-name>` example was tautological).

## 0.4.2 (2026-07-07)

- Drop the concrete strategy-skill example (`official/software-development-lifecycle`) from the lead paragraph; the framework skill now names strategies abstractly.
- Drop the `official/cli` sibling reference; CLI invocations are described as stable command names and the catalog's CLI skill is consulted separately.
- Rewrite the 0.2.0 CHANGELOG `add-subgraph` example clause forward-only.

## 0.4.1 (2026-06-15)

- §F: document the new mandatory `promptStyle` field on the `add-subgraph` human-node spec. Coord must declare `"plain"` or `"markdown"` on every insertion; the dashboard dispatches on it (plain text vs the in-house markdown renderer used by Task Overview / Artifact viewer). Includes guidance on when to pick each value (especially when prompts contain characters a markdown renderer would interpret).

## 0.3.1 (2026-06-12)

- Realign §A wake-up loop snippet and §D brief-plumbing example to the new CLI id-flag convention (`packages/cli/README.md` → "Naming conventions"): `glyph workflow show --wfid $WF` / `dag --wfid $WF` → positional `$WF`; `glyph task show --tid ${PRIOR_…_TASK_ID}` → positional. Documentation-only change.

## 0.3.0 (2026-06-12)

- **Breaking (artifact path)**: §C verdict.json location moves from `<task-workdir>/verdict.json` to `<workdir>/artifact/verdict.json` so the substrate auto-harvests it into `success.artifacts` and the dashboard Artifacts tab surfaces it. §D meta-pattern's example fetch path updated to match (`<task-workdir>/artifact/verdict.json`).
- Append **Pre-flight validation against the dispatched agent's current constitution** bullet to §D: before writing the `add-subgraph` payload, coord SKIMs each dispatched agent's `AGENTS.md` (Required output protocol, Boundaries, `dependencies.skills`) and compares against the strategy's template prescriptions. Severity matrix: output path / protocol drift → blocker (`finishWorkflow(failed)`); restated skill content → warning (log + continue); forbidden behavior → blocker. Coord does NOT patch templates inline; fixes are out-of-band via a new strategy skill version.
- Append **6. Agent compatibility statement** to §E required body sections: strategy skills declare each dispatched agent with the minimum `AGENTS.md` version validated. Coord uses this list at runtime pre-flight (per §D).

## 0.2.0 (2026-06-11)

- **Breaking**: skill renamed from `official/coordinator` to `official/workflow-coordination` to disambiguate from the `official/coordinator` agent that loads it. Update any `dependencies.skills` URL from `first-party/skills/coordinator` to `first-party/skills/workflow-coordination`.
- Fix the §B `add-subgraph` JSON example to use the current wire shape: `existingParents` on nodes, `edges[].from/to` as `NodeRefWire` objects (`{tempId}` / `{nodeId}`), and `insertedNodes[].nodeId` in the surrounding prose.

## 0.1.0 (2026-06-11)

- Initial release.
