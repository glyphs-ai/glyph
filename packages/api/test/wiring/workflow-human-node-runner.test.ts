/**
 * Tests for `makeHumanNodeRunner.validate`. The runner is the
 * `add-subgraph` substrate gateway for human-kind specs: it owns
 * shape checks for `prompt`, `promptStyle`, and `choices`.
 *
 * `dispatch` / `hasInFlightForNode` / `cancel` are exercised by the
 * workflow engine integration test in `packages/workflow/test/`; this
 * file scopes to the validator.
 */

import type { WorkflowModule, WorkflowNodeValidateCtx } from "@glyphs-ai/workflow";
import type { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import {
  makeHumanNodeRunner,
  WorkflowHumanSpecError,
} from "../../src/wiring/workflow-human-node-runner.js";

async function errCause<T>(
  resultAsync: ResultAsync<T, { readonly cause: unknown }>,
): Promise<unknown> {
  const result = await resultAsync;
  expect(result.isErr()).toBe(true);
  return result._unsafeUnwrapErr().cause;
}

const VALIDATE_CTX: WorkflowNodeValidateCtx = {
  workflowId: "20260101-deadbeef",
  workflowStatus: "running",
  coordinatorAgent: "coord",
};

function makeRunner() {
  // Validator does not call into the service, so a never-invoked
  // getter is enough — keeps the runner constructor happy without
  // standing up a real WorkflowModule.
  const getService = () => {
    throw new Error("getService should not be called from validate()");
  };
  return makeHumanNodeRunner({ getService: getService as unknown as () => WorkflowModule });
}

describe("makeHumanNodeRunner — validate", () => {
  it("accepts a minimal valid plain spec", async () => {
    const r = makeRunner();
    const result = (
      await r.validate({ prompt: "Approve?", promptStyle: "plain" }, VALIDATE_CTX)
    )._unsafeUnwrap();
    expect(result).toEqual({ prompt: "Approve?", promptStyle: "plain" });
  });

  it("accepts a minimal valid markdown spec", async () => {
    const r = makeRunner();
    const result = (
      await r.validate({ prompt: "**bold**", promptStyle: "markdown" }, VALIDATE_CTX)
    )._unsafeUnwrap();
    expect(result).toEqual({ prompt: "**bold**", promptStyle: "markdown" });
  });

  it("accepts a spec with choices", async () => {
    const r = makeRunner();
    const result = (
      await r.validate(
        {
          prompt: "Pick one",
          promptStyle: "plain",
          choices: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        VALIDATE_CTX,
      )
    )._unsafeUnwrap();
    expect(result).toEqual({
      prompt: "Pick one",
      promptStyle: "plain",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
  });

  it("rejects a spec missing promptStyle", async () => {
    const r = makeRunner();
    expect(await errCause(r.validate({ prompt: "x" }, VALIDATE_CTX))).toBeInstanceOf(
      WorkflowHumanSpecError,
    );
    expect(await errCause(r.validate({ prompt: "x" }, VALIDATE_CTX))).toHaveProperty(
      "message",
      expect.stringMatching(/promptStyle/),
    );
  });

  it("rejects a spec with an invalid promptStyle value", async () => {
    const r = makeRunner();
    expect(
      await errCause(r.validate({ prompt: "x", promptStyle: "html" }, VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowHumanSpecError);
    expect(
      await errCause(r.validate({ prompt: "x", promptStyle: "PLAIN" }, VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowHumanSpecError);
    expect(
      await errCause(r.validate({ prompt: "x", promptStyle: 1 }, VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowHumanSpecError);
    expect(
      await errCause(r.validate({ prompt: "x", promptStyle: null }, VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowHumanSpecError);
  });

  it("rejects non-object specs", async () => {
    const r = makeRunner();
    expect(await errCause(r.validate(null, VALIDATE_CTX))).toBeInstanceOf(WorkflowHumanSpecError);
    expect(await errCause(r.validate("oops", VALIDATE_CTX))).toBeInstanceOf(WorkflowHumanSpecError);
    expect(await errCause(r.validate([], VALIDATE_CTX))).toBeInstanceOf(WorkflowHumanSpecError);
  });

  it("rejects missing or empty prompt", async () => {
    const r = makeRunner();
    expect(await errCause(r.validate({ promptStyle: "plain" }, VALIDATE_CTX))).toBeInstanceOf(
      WorkflowHumanSpecError,
    );
    expect(
      await errCause(r.validate({ prompt: "   ", promptStyle: "plain" }, VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowHumanSpecError);
  });

  it("rejects too many choices", async () => {
    const r = makeRunner();
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      label: `Choice ${i}`,
    }));
    expect(
      await errCause(
        r.validate({ prompt: "p", promptStyle: "plain", choices: tooMany }, VALIDATE_CTX),
      ),
    ).toBeInstanceOf(WorkflowHumanSpecError);
  });

  it("rejects with WorkflowHumanSpecError (an Error subclass) carrying its canonical name", async () => {
    const r = makeRunner();
    const rejection = r.validate({ prompt: "x" }, VALIDATE_CTX);
    expect(await errCause(rejection)).toBeInstanceOf(WorkflowHumanSpecError);
    expect(await errCause(rejection)).toBeInstanceOf(WorkflowHumanSpecError);
    expect(await errCause(rejection)).toMatchObject({ name: "WorkflowHumanSpecError" });
  });

  it("rejects duplicate choice ids", async () => {
    const r = makeRunner();
    expect(
      await errCause(
        r.validate(
          {
            prompt: "p",
            promptStyle: "plain",
            choices: [
              { id: "x", label: "A" },
              { id: "x", label: "B" },
            ],
          },
          VALIDATE_CTX,
        ),
      ),
    ).toBeInstanceOf(WorkflowHumanSpecError);
  });
});
