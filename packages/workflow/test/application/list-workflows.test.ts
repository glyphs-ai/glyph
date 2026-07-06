import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowModule — listWorkflows", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("returns [] when no workflows exist", async () => {
    const list = (await f.module.listWorkflows.execute())._unsafeUnwrap();
    expect(list).toEqual([]);
  });

  it("returns workflows newest-first by created_at", async () => {
    f.setNow(new Date("2026-06-07T00:00:00.000Z"));
    const a = await bootstrap(f, { brief: "first" });
    f.setNow(new Date("2026-06-07T00:00:01.000Z"));
    const b = await bootstrap(f, { brief: "second" });
    f.setNow(new Date("2026-06-07T00:00:02.000Z"));
    const c = await bootstrap(f, { brief: "third" });
    const list = (await f.module.listWorkflows.execute())._unsafeUnwrap();
    expect(list.map((wf) => wf.id)).toEqual([c.workflowId, b.workflowId, a.workflowId]);
  });

  it("narrows by coordinatorAgent when supplied", async () => {
    const a = await bootstrap(f, { brief: "alpha", coordinatorAgent: "agent-alpha" });
    const b = await bootstrap(f, { brief: "beta", coordinatorAgent: "agent-beta" });

    const alpha = (
      await f.module.listWorkflows.execute({ coordinatorAgent: "agent-alpha" })
    )._unsafeUnwrap();
    expect(alpha.map((wf) => wf.id)).toEqual([a.workflowId]);

    const beta = (
      await f.module.listWorkflows.execute({ coordinatorAgent: "agent-beta" })
    )._unsafeUnwrap();
    expect(beta.map((wf) => wf.id)).toEqual([b.workflowId]);

    const none = (
      await f.module.listWorkflows.execute({ coordinatorAgent: "agent-missing" })
    )._unsafeUnwrap();
    expect(none).toEqual([]);
  });

  it("narrows by createdSince (ISO lower bound, inclusive)", async () => {
    f.setNow(new Date("2026-06-07T00:00:00.000Z"));
    const a = await bootstrap(f, { brief: "old" });
    f.setNow(new Date("2026-06-07T00:00:02.000Z"));
    const b = await bootstrap(f, { brief: "new" });

    const sinceMid = (
      await f.module.listWorkflows.execute({ createdSince: "2026-06-07T00:00:01.000Z" })
    )._unsafeUnwrap();
    expect(sinceMid.map((wf) => wf.id)).toEqual([b.workflowId]);

    const sinceAll = (
      await f.module.listWorkflows.execute({ createdSince: "2026-06-07T00:00:00.000Z" })
    )._unsafeUnwrap();
    expect(sinceAll.map((wf) => wf.id)).toEqual([b.workflowId, a.workflowId]);

    const sinceFuture = (
      await f.module.listWorkflows.execute({ createdSince: "2026-06-08T00:00:00.000Z" })
    )._unsafeUnwrap();
    expect(sinceFuture).toEqual([]);
  });

  it("narrows by idLike substring (case-sensitive, escapes LIKE metachars)", async () => {
    const a = await bootstrap(f, { brief: "alpha" });
    const b = await bootstrap(f, { brief: "beta" });
    // Both ids start with `<YYYYMMDD>-` — the date prefix matches both,
    // the 8-hex tail differs. Substring search on a unique tail fragment
    // should narrow to one row.
    const aTail = a.workflowId.slice(-4);
    const onlyA = (await f.module.listWorkflows.execute({ idLike: aTail }))._unsafeUnwrap();
    expect(onlyA.map((wf) => wf.id)).toEqual([a.workflowId]);

    // A `%` typed by an operator must NOT widen the match — the query escapes
    // LIKE metacharacters and emits an ESCAPE clause so a bare `%` is the
    // literal character. Workflow ids contain no `%`, so the result is empty.
    const withPercent = (await f.module.listWorkflows.execute({ idLike: "%" }))._unsafeUnwrap();
    expect(withPercent).toEqual([]);

    // Same defence for `_` — workflow ids contain no underscore, so a bare `_`
    // must narrow to nothing rather than match any-single-char.
    const withUnderscore = (await f.module.listWorkflows.execute({ idLike: "_" }))._unsafeUnwrap();
    expect(withUnderscore).toEqual([]);

    // Spot-check the unrelated row is still in the table so the empty
    // results above aren't an artifact of bootstrap failing.
    const all = (await f.module.listWorkflows.execute())._unsafeUnwrap();
    expect(all.map((wf) => wf.id).sort()).toEqual([a.workflowId, b.workflowId].sort());
  });

  it("AND-combines all three filters when supplied together", async () => {
    f.setNow(new Date("2026-06-07T00:00:00.000Z"));
    const a = await bootstrap(f, { brief: "alpha", coordinatorAgent: "agent-alpha" });
    f.setNow(new Date("2026-06-07T00:00:02.000Z"));
    await bootstrap(f, { brief: "beta", coordinatorAgent: "agent-beta" });
    f.setNow(new Date("2026-06-07T00:00:03.000Z"));
    await bootstrap(f, { brief: "gamma", coordinatorAgent: "agent-alpha" });

    const aTail = a.workflowId.slice(-4);
    const narrow = (
      await f.module.listWorkflows.execute({
        coordinatorAgent: "agent-alpha",
        createdSince: "2026-06-07T00:00:00.000Z",
        idLike: aTail,
      })
    )._unsafeUnwrap();
    expect(narrow.map((wf) => wf.id)).toEqual([a.workflowId]);
  });
});
