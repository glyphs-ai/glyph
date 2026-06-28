/**
 * Thrown when a string is not a structurally valid origin (a syntactically
 * well-formed https URL or a `file:` URI). Generic by design — provider
 * grammar (GitHub / Azure DevOps / filesystem layout) is the fetcher
 * adapter's concern, not the domain's.
 */
export class InvalidOriginError extends Error {
  override readonly name = "InvalidOriginError";

  constructor(
    public readonly origin: string,
    public readonly reason: string,
  ) {
    super(`invalid origin "${origin}": ${reason}`);
  }
}

/**
 * An origin identity: a well-formed https URL or a `file:` URI. `Origin`
 * owns only the GENERIC shape rule — glyph's domain knowledge that an
 * origin is a URL or a file path. It knows nothing about how to parse a
 * specific provider's URL; that lives in `fetcher/origin.ts`. Construct via
 * {@link Origin.parse} at the system boundary; the entity layer accepts an
 * already-validated `Origin` as a parameter.
 */
export class Origin {
  private constructor(readonly value: string) {}

  /** Validate a raw origin string and wrap it. Throws {@link InvalidOriginError}. */
  static parse(raw: string): Origin {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new InvalidOriginError(String(raw), "must be a non-empty string");
    }
    const v = raw.trim();
    if (v.startsWith("file:")) {
      if (v.slice("file:".length).length === 0) {
        throw new InvalidOriginError(v, "file: URI requires a path");
      }
      return new Origin(v);
    }
    if (v.startsWith("https://")) {
      try {
        new URL(v);
      } catch {
        throw new InvalidOriginError(v, "malformed https URL");
      }
      return new Origin(v);
    }
    throw new InvalidOriginError(v, "must be an https URL or a file: URI");
  }

  /** Wrap an origin already validated upstream + persisted (no re-validation). */
  static fromStored(value: string): Origin {
    return new Origin(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: Origin): boolean {
    return this.value === other.value;
  }
}
