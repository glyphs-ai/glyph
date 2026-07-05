import cronstrue from "cronstrue/i18n.js";

/**
 * English human-readable description of a cron expression. Presentation, not
 * a domain rule — so it lives outside `domain/schedule/cron.ts` (which owns
 * validation + next-fire computation via croner). Used only by the
 * PreviewSchedule use-case. The library default (English) is the right
 * choice for consumers that don't carry locale context (server JSON, CLI).
 */
export function describeCron(expr: string): string {
  return cronstrue.toString(expr, { locale: "en" });
}
