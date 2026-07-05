/**
 * Who launched this task. An open string discriminator, not a closed enum:
 * `"standalone"` is a direct user dispatch (CLI / dashboard / MCP); integration
 * handlers supply their own origin (`"schedule"`, `"workflow"`) paired with a
 * typed `originId`. The closed catalog of known origins lives at the wire
 * boundary (`@glyphs-ai/api`), not here.
 */
export type TaskOrigin = string;
