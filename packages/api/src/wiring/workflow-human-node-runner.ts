/**
 * Human-node runner for the workflow substrate.
 *
 * A human node is a gate that waits indefinitely for external input
 * via the respond API. The runner:
 *
 *   - **validate**: ensures spec has a non-empty `prompt` string and
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
  HUMAN_FREEFORM_CHOICE_ID,
  HUMAN_MAX_CHOICES,
  type HumanNodeSpec,
  WorkflowError,
  type WorkflowNodeDispatchOpts,
  type WorkflowNodeRunner,
  type WorkflowNodeValidateCtx,
  type WorkflowService,
} from "@glyphs-ai/workflow";
import type { Logger } from "pino";

export interface HumanNodeRunnerOpts {
  readonly getService: () => WorkflowService;
  readonly logger?: Logger;
}

export function makeHumanNodeRunner(opts: HumanNodeRunnerOpts): WorkflowNodeRunner {
  const { getService } = opts;

  return {
    async validate(spec: unknown, _ctx: WorkflowNodeValidateCtx): Promise<unknown> {
      if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
        throw new WorkflowError("human node spec must be an object");
      }
      const s = spec as Record<string, unknown>;

      if (typeof s.prompt !== "string" || s.prompt.trim().length === 0) {
        throw new WorkflowError("human node spec.prompt must be a non-empty string");
      }

      const choices = s.choices;
      if (choices !== undefined) {
        if (!Array.isArray(choices)) {
          throw new WorkflowError("human node spec.choices must be an array when present");
        }
        if (choices.length > HUMAN_MAX_CHOICES) {
          throw new WorkflowError(
            `human node spec.choices must have at most ${HUMAN_MAX_CHOICES} entries`,
          );
        }
        const seenIds = new Set<string>();
        for (let i = 0; i < choices.length; i++) {
          const c = choices[i];
          if (c === null || typeof c !== "object" || Array.isArray(c)) {
            throw new WorkflowError(`human node spec.choices[${i}] must be an object`);
          }
          const choice = c as Record<string, unknown>;
          if (typeof choice.id !== "string" || choice.id.length === 0) {
            throw new WorkflowError(`human node spec.choices[${i}].id must be a non-empty string`);
          }
          if (choice.id === HUMAN_FREEFORM_CHOICE_ID) {
            throw new WorkflowError(
              `human node spec.choices[${i}].id must not be the reserved value "${HUMAN_FREEFORM_CHOICE_ID}"`,
            );
          }
          if (seenIds.has(choice.id)) {
            throw new WorkflowError(
              `human node spec.choices[${i}].id "${choice.id}" is duplicated`,
            );
          }
          seenIds.add(choice.id);
          if (typeof choice.label !== "string" || choice.label.length === 0) {
            throw new WorkflowError(
              `human node spec.choices[${i}].label must be a non-empty string`,
            );
          }
        }
      }

      // Return the validated/normalized spec
      const validated: HumanNodeSpec = {
        prompt: s.prompt as string,
        ...(choices !== undefined
          ? {
              choices: (choices as Array<{ id: string; label: string }>).map((c) => ({
                id: c.id,
                label: c.label,
              })),
            }
          : {}),
      };
      return validated;
    },

    async dispatch(_opts: WorkflowNodeDispatchOpts): Promise<void> {
      // No-op: the human node simply sits in `running` status until
      // the respond API is called. No subprocess, no polling.
    },

    async hasInFlightForNode(nodeId: string): Promise<boolean> {
      const node = await getService().getNode(nodeId);
      return node.status === "running";
    },

    async cancel(_nodeId: string): Promise<void> {
      // No-op: nothing to kill. The substrate's reconcileCancel marks
      // the node cancelled directly.
    },
  };
}
