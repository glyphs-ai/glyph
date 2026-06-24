import { describe, expect, it } from "vitest";
import { ROUTES, type RouteKey } from "../src/routes.js";

/**
 * Manifest lock for the HTTP route table.
 *
 * `ROUTES` (composed in `src/routes.ts` from the per-domain slices under
 * `src/routes/`) is the single source of truth for every route's method
 * and path. This table freezes that mapping so an accidental edit to a
 * slice — a renamed key, a changed verb, a mistyped path, a route dropped
 * during a refactor — fails here at the contracts layer, before it can
 * reach the server's reflection test or a downstream consumer.
 *
 * Changing any entry below is a deliberate API change: update this table
 * in the same commit as the slice change, and keep the server route
 * handler and `packages/server/test/route-manifest.test.ts` in sync.
 *
 * Typing the keys as `RouteKey` also gives compile-time locking: a stale
 * key that no longer exists in `ROUTES` fails to type-check here.
 */
const EXPECTED_ROUTES: ReadonlyArray<readonly [RouteKey, string]> = [
  ["health.get", "GET /api/health"],
  ["config.get", "GET /api/config"],
  ["runtimes.list", "GET /api/runtimes"],
  ["workspaces.list", "GET /api/workspaces"],
  ["workspaces.create", "POST /api/workspaces"],
  ["workspaces.current.get", "GET /api/workspaces/current"],
  ["workspaces.current.set", "PUT /api/workspaces/current"],
  ["workspaces.get", "GET /api/workspaces/:id"],
  ["workspaces.update", "PATCH /api/workspaces/:id"],
  ["workspaces.delete", "DELETE /api/workspaces/:id"],
  ["workspaces.reload", "POST /api/workspaces/:id/reload"],
  ["sessions.list", "GET /api/workspaces/:id/sessions"],
  ["sessions.create", "POST /api/workspaces/:id/sessions"],
  ["sessions.get", "GET /api/workspaces/:id/sessions/:sid"],
  ["sessions.delete", "DELETE /api/workspaces/:id/sessions/:sid"],
  ["sessions.spawn", "POST /api/workspaces/:id/sessions/:sid/spawn"],
  ["tasks.list", "GET /api/workspaces/:id/tasks"],
  ["tasks.scheduled.list", "GET /api/workspaces/:id/scheduled-tasks"],
  ["tasks.dispatch", "POST /api/workspaces/:id/tasks"],
  ["tasks.get", "GET /api/workspaces/:id/tasks/:tid"],
  ["tasks.delete", "DELETE /api/workspaces/:id/tasks/:tid"],
  ["tasks.cancel", "POST /api/workspaces/:id/tasks/:tid/cancel"],
  ["tasks.activity.list", "GET /api/workspaces/:id/tasks/:tid/activity"],
  ["tasks.activity.stream", "GET /api/workspaces/:id/tasks/:tid/activity/stream"],
  ["tasks.artifacts.get", "GET /api/workspaces/:id/tasks/:tid/artifact/:name"],
  ["schedules.list", "GET /api/workspaces/:id/schedules"],
  ["schedules.task.create", "POST /api/workspaces/:id/schedules/task"],
  ["schedules.get", "GET /api/workspaces/:id/schedules/:sid"],
  ["schedules.task.patch", "PATCH /api/workspaces/:id/schedules/task/:sid"],
  ["schedules.workflow.create", "POST /api/workspaces/:id/schedules/workflow"],
  ["schedules.workflow.patch", "PATCH /api/workspaces/:id/schedules/workflow/:sid"],
  ["schedules.delete", "DELETE /api/workspaces/:id/schedules/:sid"],
  ["schedules.run", "POST /api/workspaces/:id/schedules/:sid/run"],
  ["schedules.preview", "GET /api/workspaces/:id/schedules/:sid/preview"],
  ["schedules.cron.preview", "GET /api/workspaces/:id/schedules/preview-cron"],
  ["workflows.scheduled.list", "GET /api/workspaces/:id/scheduled-workflows"],
  ["workflows.list", "GET /api/workspaces/:id/workflows"],
  ["workflows.create", "POST /api/workspaces/:id/workflows"],
  ["workflows.get", "GET /api/workspaces/:id/workflows/:wfid"],
  ["workflows.dag.get", "GET /api/workspaces/:id/workflows/:wfid/dag"],
  ["workflows.nodes.get", "GET /api/workspaces/:id/workflows/:wfid/nodes/:nid"],
  ["workflows.cancel", "POST /api/workspaces/:id/workflows/:wfid/cancel"],
  ["workflows.artifacts.list", "GET /api/workspaces/:id/workflows/:wfid/artifacts"],
  ["workflows.artifacts.get", "GET /api/workspaces/:id/workflows/:wfid/artifacts/:encodedPath"],
  ["workflows.edges.add", "POST /api/workspaces/:id/workflows/:wfid/edges"],
  ["workflows.nodes.add", "POST /api/workspaces/:id/workflows/:wfid/nodes"],
  ["workflows.subgraph.add", "POST /api/workspaces/:id/workflows/:wfid/subgraph"],
  ["workflows.nodes.cancel", "POST /api/workspaces/:id/workflows/:wfid/nodes/:nid/cancel"],
  ["workflows.nodes.respond", "POST /api/workspaces/:id/workflows/:wfid/nodes/:nid/respond"],
  ["workflows.finish", "POST /api/workspaces/:id/workflows/:wfid/finish"],
  ["workflows.delete", "DELETE /api/workspaces/:id/workflows/:wfid"],
  ["workflows.edges.remove", "DELETE /api/workspaces/:id/workflows/:wfid/edges/:from/:to"],
  ["workflows.nodes.remove", "DELETE /api/workspaces/:id/workflows/:wfid/nodes/:nid"],
  ["workflows.nodes.spec.replace", "PATCH /api/workspaces/:id/workflows/:wfid/nodes/:nid/spec"],
  ["catalog.overview.get", "GET /api/workspaces/:id/catalog/overview"],
  ["catalog.skills.list", "GET /api/workspaces/:id/catalog/skills"],
  ["catalog.skills.resolve", "POST /api/workspaces/:id/catalog/skills/resolve"],
  ["catalog.skills.get", "GET /api/workspaces/:id/catalog/skills/:name"],
  ["catalog.skills.anchor.get", "GET /api/workspaces/:id/catalog/skills/:name/anchor"],
  ["catalog.skills.install", "POST /api/workspaces/:id/catalog/skills"],
  ["catalog.skills.delete", "DELETE /api/workspaces/:id/catalog/skills/:name"],
  ["catalog.skills.sync.resolve", "POST /api/workspaces/:id/catalog/skills/:name/sync/resolve"],
  ["catalog.skills.sync", "POST /api/workspaces/:id/catalog/skills/:name/sync"],
  [
    "catalog.skills.prereqs.acknowledge",
    "POST /api/workspaces/:id/catalog/skills/:name/acknowledge-prereqs",
  ],
  ["catalog.skills.files.list", "GET /api/workspaces/:id/catalog/skills/:name/files"],
  ["catalog.skills.files.get", "GET /api/workspaces/:id/catalog/skills/:name/files/:path"],
  ["catalog.agents.list", "GET /api/workspaces/:id/catalog/agents"],
  ["catalog.agents.resolve", "POST /api/workspaces/:id/catalog/agents/resolve"],
  ["catalog.agents.get", "GET /api/workspaces/:id/catalog/agents/:name"],
  ["catalog.agents.anchor.get", "GET /api/workspaces/:id/catalog/agents/:name/anchor"],
  ["catalog.agents.install", "POST /api/workspaces/:id/catalog/agents"],
  ["catalog.agents.delete", "DELETE /api/workspaces/:id/catalog/agents/:name"],
  ["catalog.agents.sync.resolve", "POST /api/workspaces/:id/catalog/agents/:name/sync/resolve"],
  ["catalog.agents.sync", "POST /api/workspaces/:id/catalog/agents/:name/sync"],
  [
    "catalog.agents.prereqs.acknowledge",
    "POST /api/workspaces/:id/catalog/agents/:name/acknowledge-prereqs",
  ],
  ["catalog.agents.disable", "POST /api/workspaces/:id/catalog/agents/:name/disable"],
  ["catalog.agents.enable", "POST /api/workspaces/:id/catalog/agents/:name/enable"],
  ["catalog.agents.files.list", "GET /api/workspaces/:id/catalog/agents/:name/files"],
  ["catalog.agents.files.get", "GET /api/workspaces/:id/catalog/agents/:name/files/:path"],
  ["catalog.mcps.list", "GET /api/workspaces/:id/catalog/mcps"],
  ["catalog.mcps.get", "GET /api/workspaces/:id/catalog/mcps/:name"],
  ["catalog.mcps.install", "POST /api/workspaces/:id/catalog/mcps"],
  ["catalog.mcps.delete", "DELETE /api/workspaces/:id/catalog/mcps/:name"],
  ["catalog.mcps.sync.resolve", "POST /api/workspaces/:id/catalog/mcps/:name/sync/resolve"],
  ["catalog.mcps.sync", "POST /api/workspaces/:id/catalog/mcps/:name/sync"],
];

describe("ROUTES manifest", () => {
  it("locks the exact set of route keys", () => {
    const actual = Object.keys(ROUTES).sort();
    const expected = EXPECTED_ROUTES.map(([key]) => key).sort();
    expect(actual).toEqual(expected);
  });

  it("locks each route's method and path", () => {
    const actual = Object.fromEntries(
      Object.entries(ROUTES).map(([key, spec]) => [key, `${spec.method} ${spec.path}`]),
    );
    const expected = Object.fromEntries(EXPECTED_ROUTES);
    expect(actual).toEqual(expected);
  });

  it("has no duplicate method+path pairs", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [key, spec] of Object.entries(ROUTES)) {
      const signature = `${spec.method} ${spec.path}`;
      const prior = seen.get(signature);
      if (prior) duplicates.push(`${signature} declared by both ${prior} and ${key}`);
      else seen.set(signature, key);
    }
    expect(duplicates).toEqual([]);
  });
});
