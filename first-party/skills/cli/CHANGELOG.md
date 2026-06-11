# Changelog

## 0.1.1

- Fix `add-subgraph` JSON examples in `references/workflow-commands.md` to match the actual wire shape: `existingParents` (not `parents`), `edges[].from/to` as `NodeRefWire` objects (`{tempId}` / `{nodeId}`, not bare strings), and `AddSubgraphResultWire.insertedNodes` (not `inserted`).
- Update references to the generic coord framework skill: `official/coordinator` → `official/workflow-coordination` (the skill was renamed to disambiguate from the agent of the same name).

## 0.1.0

- Initial release.
