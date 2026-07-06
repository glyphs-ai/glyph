import cronstrue from "cronstrue/i18n.js";

/**
 * English human-readable description of a cron expression. Presentation, not
 * a domain rule — so it lives outside the domain cron service (which owns
 * validation + next-fire computation via croner). English is the right
 * default for consumers that don't carry locale context (server JSON, CLI).
 */
export function describeCron(expr: string): string {
  return cronstrue.toString(expr, { locale: "en" });
}
