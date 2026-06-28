/**
 * Error hierarchy for `@glyphs-ai/__PKG__`. All errors extend
 * {@link __Entity__Error} so callers can `instanceof` a coarse check
 * within the same realm; cross-realm callers (HTTP routes, CLI) should
 * branch on the stable `name` string literal instead — bundlers can
 * split the class definitions.
 *
 * These are PRECONDITION / conflict errors — the BC's state forbids the
 * operation. Input *format* validation is NOT here: it lives as zod
 * schemas in `./__entity-kebab__.schemas.ts` and surfaces as `ZodError`
 * from the service's `Schema.parse(...)` calls, which the api layer maps
 * to a 400 `ValidationError` envelope.
 *
 * Convention: every subclass declares `override readonly name = "..."`
 * with a literal string equal to the class name. Do NOT use
 * `this.name = new.target.name` (dynamic; breaks under name-mangling
 * bundlers).
 */
export class __Entity__Error extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "__Entity__Error";
  }
}

export class __Entity__NotFoundError extends __Entity__Error {
  override readonly name = "__Entity__NotFoundError";
  constructor(public readonly id: string) {
    super(`__Entity__ "${id}" not found`);
  }
}
