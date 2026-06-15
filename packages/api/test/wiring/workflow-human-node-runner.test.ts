/**
 * Tests for `makeHumanNodeRunner.validate`. The runner is the
 * `add-subgraph` substrate gateway for human-kind specs: it owns
 * shape checks for `prompt`, `promptStyle`, and `choices`.
 *
 * `dispatch` / `hasInFlightForNode` / `cancel` are exercised by the
 * workflow engine integration test in `packages/workflow/test/`; this
 * file scopes to the validator.
 */

import {
  WorkflowError,
  type WorkflowNodeValidateCtx,
  type WorkflowService,
} from "@glyphs-ai/workflow";
import { describe, expect, it } from "vitest";
import { makeHumanNodeRunner } from "../../src/wiring/workflow-human-node-runner.js";

const VALIDATE_CTX: WorkflowNodeValidateCtx = {
  workflowId: "20260101-deadbeef",
  workflowStatus: "running",
  coordinatorAgent: "coord",
};

function makeRunner() {
  // Validator does not call into the service, so a never-invoked
  // getter is enough — keeps the runner constructor happy without
  // standing up a real WorkflowService.
  const getService = () => {
    throw new Error("getService should not be called from validate()");
  };
  return makeHumanNodeRunner({ getService: getService as unknown as () => WorkflowService });
}

describe("makeHumanNodeRunner — validate", () => {
  it("accepts a minimal valid plain spec", async () => {
    const r = makeRunner();
    const result = await r.validate({ prompt: "Approve?", promptStyle: "plain" }, VALIDATE_CTX);
    expect(result).toEqual({ prompt: "Approve?", promptStyle: "plain" });
  });

  it("accepts a minimal valid markdown spec", async () => {
    const r = makeRunner();
    const result = await r.validate({ prompt: "**bold**", promptStyle: "markdown" }, VALIDATE_CTX);
    expect(result).toEqual({ prompt: "**bold**", promptStyle: "markdown" });
  });

  it("accepts a spec with choices", async () => {
    const r = makeRunner();
    const result = await r.validate(
      {
        prompt: "Pick one",
        promptStyle: "plain",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      VALIDATE_CTX,
    );
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
    await expect(r.validate({ prompt: "x" }, VALIDATE_CTX)).rejects.toBeInstanceOf(WorkflowError);
    await expect(r.validate({ prompt: "x" }, VALIDATE_CTX)).rejects.toThrow(/promptStyle/);
  });

  it("rejects a spec with an invalid promptStyle value", async () => {
    const r = makeRunner();
    await expect(
      r.validate({ prompt: "x", promptStyle: "html" }, VALIDATE_CTX),
    ).rejects.toBeInstanceOf(WorkflowError);
    await expect(
      r.validate({ prompt: "x", promptStyle: "PLAIN" }, VALIDATE_CTX),
    ).rejects.toBeInstanceOf(WorkflowError);
    await expect(r.validate({ prompt: "x", promptStyle: 1 }, VALIDATE_CTX)).rejects.toBeInstanceOf(
      WorkflowError,
    );
    await expect(
      r.validate({ prompt: "x", promptStyle: null }, VALIDATE_CTX),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it("rejects non-object specs", async () => {
    const r = makeRunner();
    await expect(r.validate(null, VALIDATE_CTX)).rejects.toBeInstanceOf(WorkflowError);
    await expect(r.validate("oops", VALIDATE_CTX)).rejects.toBeInstanceOf(WorkflowError);
    await expect(r.validate([], VALIDATE_CTX)).rejects.toBeInstanceOf(WorkflowError);
  });

  it("rejects missing or empty prompt", async () => {
    const r = makeRunner();
    await expect(r.validate({ promptStyle: "plain" }, VALIDATE_CTX)).rejects.toBeInstanceOf(
      WorkflowError,
    );
    await expect(
      r.validate({ prompt: "   ", promptStyle: "plain" }, VALIDATE_CTX),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it("rejects too many choices", async () => {
    const r = makeRunner();
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      label: `Choice ${i}`,
    }));
    await expect(
      r.validate({ prompt: "p", promptStyle: "plain", choices: tooMany }, VALIDATE_CTX),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it("rejects duplicate choice ids", async () => {
    const r = makeRunner();
    await expect(
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
    ).rejects.toBeInstanceOf(WorkflowError);
  });
});
