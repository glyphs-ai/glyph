# Changelog

## 0.2.0 (2026-06-11)

- **Breaking**: skill renamed from `official/coordinator` to `official/workflow-coordination` to disambiguate from the `official/coordinator` agent that loads it. Update any `dependencies.skills` URL from `first-party/skills/coordinator` to `first-party/skills/workflow-coordination`.
- Fix the §B `add-subgraph` JSON example to match the actual wire shape: `existingParents` (not `parents`), `edges[].from/to` as `NodeRefWire` objects (`{tempId}` / `{nodeId}`, not bare strings), and reference `insertedNodes[].nodeId` (not `inserted[].nodeId`) in the surrounding prose.

## 0.1.0 (2026-06-11)

- Initial release.
