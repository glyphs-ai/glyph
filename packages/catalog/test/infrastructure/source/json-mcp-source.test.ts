import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { OriginInvalid, SourceUnavailable } from "../../../src/domain/source.js";
import type { FetcherRegistry } from "../../../src/infrastructure/source/fetcher/registry.js";
import { JsonMcpSource } from "../../../src/infrastructure/source/json-mcp-source.js";

/**
 * The fetcher is stubbed so `JsonMcpSource` tests do not touch the
 * filesystem or network.
 */
const ORIGIN = "file:/catalog/mcps/azure.json";

function fetcherOf(files: ReadonlyMap<string, Buffer>): FetcherRegistry {
  return { fetchEntry: () => okAsync(files) } as unknown as FetcherRegistry;
}

function fetcherFailing(e: OriginInvalid | SourceUnavailable): FetcherRegistry {
  return {
    fetchEntry: () => errAsync(e) as ResultAsync<ReadonlyMap<string, Buffer>, typeof e>,
  } as unknown as FetcherRegistry;
}

describe("JsonMcpSource", () => {
  it("builds a manifest from the sole JSON file, keeping spec verbatim", async () => {
    const spec = '{"_meta":{"name":"azure/mcp"},"command":"npx"}';
    const files = new Map([["azure.json", Buffer.from(spec)]]);
    const res = await new JsonMcpSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isOk()).toBe(true);
    const m = res._unsafeUnwrap();
    expect(m.name).toBe("azure/mcp");
    expect(m.spec).toBe(spec);
  });

  it("ManifestInvalid when the origin yields no file", async () => {
    const res = await new JsonMcpSource(fetcherOf(new Map())).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid on malformed JSON", async () => {
    const files = new Map([["azure.json", Buffer.from("{not json")]]);
    const res = await new JsonMcpSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when _meta.name violates the fqn grammar", async () => {
    const files = new Map([["azure.json", Buffer.from('{"_meta":{"name":"no-slash"}}')]]);
    const res = await new JsonMcpSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates fetcher OriginInvalid / SourceUnavailable verbatim", async () => {
    const oi = await new JsonMcpSource(
      fetcherFailing({ type: "OriginInvalid", origin: ORIGIN, reason: "bad" }),
    ).load(ORIGIN);
    expect(oi._unsafeUnwrapErr().type).toBe("OriginInvalid");
    const su = await new JsonMcpSource(
      fetcherFailing({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("net") }),
    ).load(ORIGIN);
    expect(su._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
