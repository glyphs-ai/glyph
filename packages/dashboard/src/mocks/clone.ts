/**
 * Simple recursive deep-clone utility for plain objects and arrays.
 * Used by the mock store to snapshot fixture data at seed time so
 * in-memory mutations never corrupt the original fixtures (which are
 * shared across component tests that expect stable data).
 *
 * Handles: primitives, plain objects, arrays, Date, null, undefined.
 * Does NOT handle: Map, Set, Blob, circular refs, class instances.
 * This is intentional — fixture data is always JSON-serialisable.
 */
export function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneDeep(item)) as T;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    result[key] = cloneDeep((value as Record<string, unknown>)[key]);
  }
  return result as T;
}
