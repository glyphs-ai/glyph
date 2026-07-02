import { z } from "zod";

/** Maximum number of user-supplied choices on a human node spec. */
export const HUMAN_MAX_CHOICES = 5;

/** Closed enum of supported human-node prompt rendering styles. */
export const HumanNodePromptStyleSchema = z.enum(["plain", "markdown"]);
export type HumanNodePromptStyle = z.infer<typeof HumanNodePromptStyleSchema>;

/** All valid human-node prompt rendering styles; used by validators and renderers. */
export const HUMAN_PROMPT_STYLES = HumanNodePromptStyleSchema.options;

/** One selectable choice on a human node. */
export const HumanNodeChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
});
export type HumanNodeChoice = z.infer<typeof HumanNodeChoiceSchema>;

/** Spec shape for a `human`-kind workflow node. */
export const HumanNodeSpecSchema = z.object({
  prompt: z.string().min(1),
  promptStyle: HumanNodePromptStyleSchema,
  choices: z.array(HumanNodeChoiceSchema).max(HUMAN_MAX_CHOICES).readonly().optional(),
});
export type HumanNodeSpec = z.infer<typeof HumanNodeSpecSchema>;

/** Response written into `node.metadata.response` after a human answers. */
export const HumanNodeResponseSchema = z.object({
  choiceId: z.string().optional(),
  input: z.string().optional(),
});
export type HumanNodeResponse = z.infer<typeof HumanNodeResponseSchema>;
