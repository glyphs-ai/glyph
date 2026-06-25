import type {
  AgentEntry,
  PatchTaskScheduleRequest,
  PatchWorkflowScheduleRequest,
} from "@glyphs-ai/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSchedule, patchSchedule, patchWorkflowSchedule, type ScheduleDetail } from "../../api";
import { Modal } from "../Modal";
import { presetToCron, validatePreset } from "./cron-presets";
import { ScheduleFormFields } from "./ScheduleFormFields";
import {
  buildTimezoneOptions,
  isBriefValid,
  type ScheduleFormPatch,
  type ScheduleFormState,
} from "./schedule-form-shared";
import { targetAgent, targetBrief, targetDetails, targetRuntime } from "./shared";
import { useSchedulePreview } from "./useSchedulePreview";

// Mutable mirrors of the contracts PATCH request shapes — the
// builder below assigns fields conditionally, so we strip
// `readonly` recursively (the nested `target` is also readonly) for
// local construction. The wire payload is then shipped through
// `patchSchedule` / `patchWorkflowSchedule`, whose signatures are
// the canonical readonly contracts type.
type DeepMutable<T> = T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
type MutablePatchTaskSchedule = DeepMutable<PatchTaskScheduleRequest>;
type MutablePatchWorkflowSchedule = DeepMutable<PatchWorkflowScheduleRequest>;

export interface EditScheduleModalProps {
  open: boolean;
  schedule: ScheduleDetail;
  agents: AgentEntry[];
  runtimes: string[];
  /** Timezones already present on the workspace's existing schedules. */
  existingTimezones: string[];
  onClose: () => void;
  /**
   * Called after a successful PATCH with the freshly-built
   * {@link ScheduleDetail}. Re-uses `getSchedule` to refresh
   * `describe` whether or not the trigger changed — one round-trip,
   * no branching.
   */
  onPatched: (next: ScheduleDetail) => void;
}

/**
 * Edit-schedule modal.
 *
 * Mirrors `CreateScheduleModal`'s field layout (both render
 * {@link ScheduleFormFields}). Differences from Create:
 *   - Initial preset is `{ kind: "advanced", expr }` so the existing
 *     cron expression is shown verbatim (no reverse-parser to a
 *     preset kind — too brittle for the gain).
 *   - No `enabled` toggle (`ScheduleDetail`'s Pause/Resume owns
 *     enabled-state; two surfaces for one boolean is a source-of-
 *     truth conflict).
 *   - Submit builds a sparse {@link PatchTaskScheduleRequest} via field-by-
 *     field diff (trim-before-compare). `target.details` /
 *     `target.runtime` use RFC 7396 `null` when the user clears a
 *     previously-set value.
 *   - "No diff" disables submit so the button doesn't fire a
 *     meaningless PATCH.
 */
export function EditScheduleModal({
  open,
  schedule,
  agents,
  runtimes,
  existingTimezones,
  onClose,
  onPatched,
}: EditScheduleModalProps) {
  // Edit supports both task- and workflow-kind schedules. Target
  // fields are extracted through the shared kind-guarded helpers so
  // the seed never relies on an `as`-cast: `targetAgent` returns the
  // task agent or the workflow coordinator agent, `targetRuntime` is
  // task-only (undefined for workflow → empty string, and the Runtime
  // select is hidden for workflow kind regardless).
  const seedKind: ScheduleFormState["kind"] =
    schedule.target.kind === "workflow" ? "workflow" : "task";
  const seedAgent = targetAgent(schedule.target);
  const seedBrief = targetBrief(schedule.target);
  const seedDetails = targetDetails(schedule.target) ?? "";
  const seedRuntime = targetRuntime(schedule.target) ?? "";
  const [state, setState] = useState<ScheduleFormState>(() => ({
    kind: seedKind,
    name: schedule.name,
    agent: seedAgent,
    runtime: seedRuntime,
    brief: seedBrief,
    details: seedDetails,
    preset: { kind: "advanced", expr: schedule.trigger.expr },
    tz: schedule.trigger.tz,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const dispatch = useCallback<(patch: ScheduleFormPatch) => void>(
    (patch) => setState((prev) => ({ ...prev, ...patch })),
    [],
  );

  // Reseed all fields whenever the modal opens or the underlying
  // schedule changes (parent may have updated it via Pause/Resume
  // while the modal was closed). Idempotent on re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed when `open` flips OR when `schedule.id` changes; not on every schedule mutation (the user is mid-edit)
  useEffect(() => {
    if (!open) return;
    setState({
      kind: seedKind,
      name: schedule.name,
      agent: seedAgent,
      runtime: seedRuntime,
      brief: seedBrief,
      details: seedDetails,
      preset: { kind: "advanced", expr: schedule.trigger.expr },
      tz: schedule.trigger.tz,
    });
    setSubmitError(null);
    setSubmitting(false);
  }, [open, schedule.id]);

  const tzOptions = useMemo(
    () => buildTimezoneOptions([schedule.trigger.tz, ...existingTimezones]),
    [schedule.trigger.tz, existingTimezones],
  );

  const expr = useMemo(() => presetToCron(state.preset), [state.preset]);
  const presetError = useMemo(() => validatePreset(state.preset), [state.preset]);

  const { preview, previewLoading, previewError } = useSchedulePreview({
    enabled: open,
    expr,
    tz: state.tz,
    presetError,
  });

  // Build the sparse PATCH body, discriminated by target kind so the
  // task and workflow shapes each stay correctly typed (no union
  // narrowing at the call site). Trim-before-compare matches the "no
  // diff disables submit" gate to the actual wire payload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the seed* values are derived from `schedule` (already a dep) — re-listing them would needlessly re-run on unrelated schedule mutations while the user is mid-edit
  const patch = useMemo<
    | { kind: "task"; body: MutablePatchTaskSchedule }
    | { kind: "workflow"; body: MutablePatchWorkflowSchedule }
  >(() => {
    const trimmedName = state.name.trim();
    const trimmedBrief = state.brief.trim();
    const trimmedDetails = state.details.trim();
    const triggerChanged = expr !== schedule.trigger.expr || state.tz !== schedule.trigger.tz;

    if (state.kind === "workflow") {
      const body: MutablePatchWorkflowSchedule = {};
      if (trimmedName !== schedule.name) body.name = trimmedName;
      const target: NonNullable<MutablePatchWorkflowSchedule["target"]> = {};
      if (state.agent !== seedAgent) target.coordinatorAgent = state.agent;
      if (trimmedBrief !== seedBrief) target.brief = trimmedBrief;
      if (trimmedDetails !== seedDetails) {
        target.details = trimmedDetails === "" ? null : trimmedDetails;
      }
      if (Object.keys(target).length > 0) body.target = target;
      if (triggerChanged) body.trigger = { kind: "cron", expr, tz: state.tz };
      return { kind: "workflow", body };
    }

    const body: MutablePatchTaskSchedule = {};
    if (trimmedName !== schedule.name) body.name = trimmedName;
    const target: NonNullable<MutablePatchTaskSchedule["target"]> = {};
    if (state.agent !== seedAgent) target.agent = state.agent;
    if (trimmedBrief !== seedBrief) target.brief = trimmedBrief;
    if (trimmedDetails !== seedDetails) {
      target.details = trimmedDetails === "" ? null : trimmedDetails;
    }
    if (state.runtime !== seedRuntime) {
      target.runtime = state.runtime === "" ? null : state.runtime;
    }
    if (Object.keys(target).length > 0) body.target = target;
    if (triggerChanged) body.trigger = { kind: "cron", expr, tz: state.tz };
    return { kind: "task", body };
  }, [state, expr, schedule]);

  const hasDiff = Object.keys(patch.body).length > 0;

  const canSubmit =
    !submitting &&
    hasDiff &&
    state.name.trim() !== "" &&
    state.agent !== "" &&
    isBriefValid(state.brief) &&
    presetError === null &&
    previewError === null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (patch.kind === "workflow") {
        await patchWorkflowSchedule(schedule.id, patch.body);
      } else {
        await patchSchedule(schedule.id, patch.body);
      }
      // PATCH returns `ScheduleView` (no `describe`). Re-fetch via
      // `getSchedule` so the merged `ScheduleDetail` carries the
      // server's fresh `describe` whether or not the trigger changed;
      // one round-trip, no branching.
      const merged = await getSchedule(schedule.id);
      onPatched(merged);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit schedule — ${schedule.name}`} size="large">
      <form onSubmit={onSubmit} data-testid="edit-schedule-form">
        <div className="modal__body">
          <ScheduleFormFields
            idPrefix="edit-schedule"
            testIdPrefix="edit-schedule"
            agents={agents}
            runtimes={runtimes}
            tzOptions={tzOptions}
            disabled={submitting}
            state={state}
            onChange={dispatch}
            expr={expr}
            presetError={presetError}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            defaultOptionMode="always"
            detailsLabelSuffix=" — clear to remove"
          />

          {submitError !== null && (
            <div
              className="alert alert--error"
              style={{ marginTop: 8 }}
              data-testid="edit-schedule-submit-error"
            >
              ⚠️ {submitError}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
            data-testid="edit-schedule-submit"
            title={!hasDiff ? "No changes to save" : undefined}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
