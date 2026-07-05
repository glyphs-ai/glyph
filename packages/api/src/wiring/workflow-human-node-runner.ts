/**
 * Human-node runner for the workflow substrate.
 *
 * A human node is a gate that waits indefinitely for external input
 * via the respond API. The runner:
 *
 *   - **validate**: ensures spec has a non-empty `prompt` string, a
 *     `promptStyle` enum value (`"plain"` | `"markdown"`), and an
 *     optional `choices` array (≤5 entries, each with unique non-
 *     reserved `id` + non-empty `label`).
 *   - **dispatch**: no-op — the node sits in `running` until the
 *     respond API marks it succeeded.
 *   - **hasInFlightForNode**: checks if the node is still `running`
 *     in the DB.
 *   - **cancel**: no-op — nothing to kill; the substrate's
 *     `reconcileCancel` marks it cancelled directly.
 */

import {
  HUMAN_MAX_CHOICES,
  HUMAN_PROMPT_STYLES,
  type HumanNodePromptStyle,
  type HumanNodeSpec,
  type RunnerFault,
  type WorkflowId,
  type WorkflowModule,
  type WorkflowNodeDispatchOpts,
  type WorkflowNodeId,
  type WorkflowNodeRunner,
  type WorkflowNodeValidateCtx,
} from "@glyphs-ai/workflow";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";

/**
 * Wire-shape error for a malformed human node spec. Mirrors
 * {@link WorkflowCoordSpecError} / {@link WorkflowWorkerSpecError} so the
 * three node runners stay isomorphic.
 */
export class WorkflowHumanSpecError extends Error {
  override readonly name = "WorkflowHumanSpecError";
}

export interface HumanNodeRunnerOpts {
  readonly getModule?: () => WorkflowModule;
  readonly getService?: () => WorkflowModule;
}

export function makeHumanNodeRunner(opts: HumanNodeRunnerOpts): WorkflowNodeRunner {
  const getModule = opts.getModule ?? opts.getService;
  const workflowIdsByNodeId = new Map<string, string>();

  return {
    validate(spec: unknown, _ctx: WorkflowNodeValidateCtx) {
      return new ResultAsync(
        (async (): Promise<Result<unknown, RunnerFault>> => {
          if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
            return err({ cause: new WorkflowHumanSpecError("human node spec must be an object") });
          }
          const s = spec as Record<string, unknown>;

          if (typeof s.prompt !== "string" || s.prompt.trim().length === 0) {
            return err({
              cause: new WorkflowHumanSpecError(
                "human node spec.prompt must be a non-empty string",
              ),
            });
          }

          if (s.promptStyle === undefined) {
            return err({
              cause: new WorkflowHumanSpecError(
                `human node spec.promptStyle is required; must be one of: ${HUMAN_PROMPT_STYLES.join(", ")}`,
              ),
            });
          }
          if (
            typeof s.promptStyle !== "string" ||
            !(HUMAN_PROMPT_STYLES as readonly string[]).includes(s.promptStyle)
          ) {
            return err({
              cause: new WorkflowHumanSpecError(
                `human node spec.promptStyle must be one of: ${HUMAN_PROMPT_STYLES.join(", ")}`,
              ),
            });
          }
          const promptStyle = s.promptStyle as HumanNodePromptStyle;

          const choices = s.choices;
          if (choices !== undefined) {
            if (!Array.isArray(choices)) {
              return err({
                cause: new WorkflowHumanSpecError(
                  "human node spec.choices must be an array when present",
                ),
              });
            }
            if (choices.length > HUMAN_MAX_CHOICES) {
              return err({
                cause: new WorkflowHumanSpecError(
                  `human node spec.choices must have at most ${HUMAN_MAX_CHOICES} entries`,
                ),
              });
            }
            const seenIds = new Set<string>();
            for (let i = 0; i < choices.length; i++) {
              const c = choices[i];
              if (c === null || typeof c !== "object" || Array.isArray(c)) {
                return err({
                  cause: new WorkflowHumanSpecError(
                    `human node spec.choices[${i}] must be an object`,
                  ),
                });
              }
              const choice = c as Record<string, unknown>;
              if (typeof choice.id !== "string" || choice.id.length === 0) {
                return err({
                  cause: new WorkflowHumanSpecError(
                    `human node spec.choices[${i}].id must be a non-empty string`,
                  ),
                });
              }
              if (seenIds.has(choice.id)) {
                return err({
                  cause: new WorkflowHumanSpecError(
                    `human node spec.choices[${i}].id "${choice.id}" is duplicated`,
                  ),
                });
              }
              seenIds.add(choice.id);
              if (typeof choice.label !== "string" || choice.label.length === 0) {
                return err({
                  cause: new WorkflowHumanSpecError(
                    `human node spec.choices[${i}].label must be a non-empty string`,
                  ),
                });
              }
            }
          }

          // Return the validated/normalized spec
          const validated: HumanNodeSpec = {
            prompt: s.prompt as string,
            promptStyle,
            ...(choices !== undefined
              ? {
                  choices: (choices as Array<{ id: string; label: string }>).map((c) => ({
                    id: c.id,
                    label: c.label,
                  })),
                }
              : {}),
          };
          return ok(validated);
        })(),
      );
    },

    dispatch(opts: WorkflowNodeDispatchOpts) {
      workflowIdsByNodeId.set(opts.nodeId, opts.workflowId);
      // No-op: the human node simply sits in `running` status until
      // the respond API is called. No subprocess, no polling.
      return okAsync(undefined);
    },

    hasInFlightForNode(nodeId: string) {
      return new ResultAsync(
        (async (): Promise<Result<boolean, RunnerFault>> => {
          const module = getModule?.();
          if (module === undefined) {
            return err({ cause: new Error("workflow-human-node-runner: missing module") });
          }
          const workflowId = workflowIdsByNodeId.get(nodeId);
          if (workflowId === undefined) {
            return err({
              cause: new Error(
                `workflow-human-node-runner: missing workflow id for node ${nodeId}`,
              ),
            });
          }
          const nodeResult = await module.getNode.execute({
            workflowId: workflowId as WorkflowId,
            nodeId: nodeId as WorkflowNodeId,
          });
          if (nodeResult.isErr()) return err({ cause: new Error(nodeResult.error.type) });
          const node = nodeResult.value;
          return ok(node.status === "running");
        })(),
      );
    },

    cancel(_nodeId: string) {
      // No-op: nothing to kill. The substrate's reconcileCancel marks
      // the node cancelled directly.
      return okAsync(undefined);
    },

    listArtifacts() {
      return okAsync(null);
    },

    resolveArtifactPath() {
      return okAsync(null);
    },
  };
}
