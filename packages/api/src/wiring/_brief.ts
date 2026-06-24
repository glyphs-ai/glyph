/**
 * Shared brief-shape predicate for the schedule / workflow wiring
 * validators.
 *
 * Three sibling sites — the task schedule handler, the workflow
 * schedule handler, and the workflow worker-node runner — enforce the
 * same single-line / length contract on their `brief` field (documented
 * canonically in `packages/contracts/src/workflows.ts`). Each keeps its
 * own bespoke error class for instanceof-stable wire routing, so this
 * helper takes the class as an argument and only owns the predicate:
 * one place to touch if the 200-character limit or the single-line rule
 * ever changes.
 *
 * The caller has already proven `brief` is a non-empty string before
 * reaching here.
 */
export function assertBriefShape(
  brief: string,
  label: string,
  ErrorClass: new (message: string) => Error,
): void {
  if (brief.includes("\n") || brief.includes("\r")) {
    throw new ErrorClass(
      `${label} brief must be a single line (no newline characters); pass long content via details`,
    );
  }
  if (brief.trim().length > 200) {
    throw new ErrorClass(`${label} brief must be 200 characters or fewer`);
  }
}
