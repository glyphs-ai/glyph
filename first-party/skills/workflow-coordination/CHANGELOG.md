# Changelog

## 0.3.0 (2026-06-12)

- **Breaking (artifact path)**: §C verdict.json location moves from `<task-workdir>/verdict.json` to `<workdir>/artifact/verdict.json` so the substrate auto-harvests it into `success.artifacts` and the dashboard Artifacts tab surfaces it. §D meta-pattern's example fetch path updated to match (`<task-workdir>/artifact/verdict.json`).
- Append **Pre-flight validation against the dispatched agent's current constitution** bullet to §D: before writing the `add-subgraph` payload, coord SKIMs each dispatched agent's `AGENTS.md` (Required output protocol, Boundaries, `dependencies.skills`) and compares against the strategy's template prescriptions. Severity matrix: output path / protocol drift → blocker (`finishWorkflow(failed)`); restated skill content → warning (log + continue); forbidden behavior → blocker. Coord does NOT patch templates inline; fixes are out-of-band via a new strategy skill version.
- Append **6. Agent compatibility statement** to §E required body sections: strategy skills declare each dispatched agent with the minimum `AGENTS.md` version validated. Coord uses this list at runtime pre-flight (per §D).

## 0.2.0 (2026-06-11)

- **Breaking**: skill renamed from `official/coordinator` to `official/workflow-coordination` to disambiguate from the `official/coordinator` agent that loads it. Update any `dependencies.skills` URL from `first-party/skills/coordinator` to `first-party/skills/workflow-coordination`.
- Fix the §B `add-subgraph` JSON example to match the actual wire shape: `existingParents` (not `parents`), `edges[].from/to` as `NodeRefWire` objects (`{tempId}` / `{nodeId}`, not bare strings), and reference `insertedNodes[].nodeId` (not `inserted[].nodeId`) in the surrounding prose.

## 0.1.0 (2026-06-11)

- Initial release.
