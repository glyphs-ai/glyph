import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import {
  awaitTerminal,
  buildSupervisorFixture,
  dispatchArgs,
  type SupervisorFixture,
} from "./task-fixture.js";

let fx: SupervisorFixture | undefined;

afterEach(() => {
  fx?.cleanup();
  fx = undefined;
});

describe("TaskSupervisor.runDispatch", () => {
  it("persists a running row, materialises the workdir, and arms the exit watcher", async () => {
    fx = buildSupervisorFixture();
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();

    expect(running.status).toBe("running");
    expect(running.metadata.runtimeSessionId).toBe("rsid-1");
    expect(fx.supervisor.liveCount()).toBe(1);
    const workdir = fx.sandbox.resolve(running.id);
    expect(existsSync(join(workdir, "TASK.md"))).toBe(true);
    expect(existsSync(join(workdir, "artifact"))).toBe(true);
  });

  it("classifies a clean exit (code 0) as succeeded and collects the agent output", async () => {
    fx = buildSupervisorFixture();
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();

    fx.runtime.handles[0]?.resolveExit({ code: 0, signal: null });
    const terminal = await awaitTerminal(fx.repo, running.id);

    expect(terminal.status).toBe("succeeded");
    expect(terminal.success?.output).toBe("PR: https://example.test/pr/1");
    expect(fx.supervisor.liveCount()).toBe(0);
  });

  it("classifies a non-zero exit as failed/execution", async () => {
    fx = buildSupervisorFixture();
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();

    fx.runtime.handles[0]?.resolveExit({ code: 1, signal: null });
    const terminal = await awaitTerminal(fx.repo, running.id);

    expect(terminal.status).toBe("failed");
    expect(terminal.failure).toEqual({
      kind: "execution",
      exitCode: 1,
      message: "exited with code 1",
    });
  });
});

describe("TaskSupervisor.cancel", () => {
  it("kills a running subprocess and records a user cancellation", async () => {
    fx = buildSupervisorFixture({ autoExitOnKill: true });
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();

    const cancelled = (await fx.supervisor.cancel(running.id))._unsafeUnwrap();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellation?.kind).toBe("user");
    expect(fx.runtime.handles[0]?.killCount).toBe(1);
  });

  it("rejects cancelling a terminal task with InvalidTransition", async () => {
    fx = buildSupervisorFixture();
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();
    fx.runtime.handles[0]?.resolveExit({ code: 0, signal: null });
    await awaitTerminal(fx.repo, running.id);

    expect((await fx.supervisor.cancel(running.id))._unsafeUnwrapErr().type).toBe(
      "InvalidTransition",
    );
  });

  it("returns TaskNotFound for an unknown id", async () => {
    fx = buildSupervisorFixture();
    const ghost = TaskIdSchema.parse("20260508-000000ff");
    expect((await fx.supervisor.cancel(ghost))._unsafeUnwrapErr().type).toBe("TaskNotFound");
  });
});

describe("TaskSupervisor.shutdown", () => {
  it("kills every live subprocess and records failure/cascade", async () => {
    fx = buildSupervisorFixture({ autoExitOnKill: true });
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();

    await fx.supervisor.shutdown();
    const terminal = await awaitTerminal(fx.repo, running.id);

    expect(terminal.status).toBe("failed");
    expect(terminal.failure?.kind).toBe("cascade");
    expect(fx.supervisor.isShuttingDown).toBe(true);
  });

  it("refuses cancel while shutting down", async () => {
    fx = buildSupervisorFixture({ autoExitOnKill: true });
    const running = (
      await fx.supervisor.runDispatch(dispatchArgs({ runtime: fx.runtime }))
    )._unsafeUnwrap();
    await fx.supervisor.shutdown();

    expect((await fx.supervisor.cancel(running.id))._unsafeUnwrapErr().type).toBe(
      "ManagerShuttingDown",
    );
  });
});
