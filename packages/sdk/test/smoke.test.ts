import { describe, expect, it } from "vitest";
import { buildOpenApiApp } from "../scripts/build-openapi-app.js";
import { client, getApiHealth, unwrap } from "../src/index.js";

/**
 * End-to-end proof that the generated client composes with the real
 * server: assemble the OpenAPI app in-process (the same mount tree the
 * codegen reads) and drive the generated `getApiHealth` operation at it
 * with no socket and no port — `app.request` is a `fetch`-compatible
 * callable used as the client's `fetch` override.
 */
describe("sdk ↔ server smoke", () => {
  it("round-trips GET /api/health through the generated client", async () => {
    const app = buildOpenApiApp();
    const fetchImpl: typeof fetch = async (input, init) => app.request(input, init);

    client.setConfig({ baseUrl: "http://sdk.test", fetch: fetchImpl });

    const data = unwrap(await getApiHealth());

    expect(data.status).toBe("ok");
    expect(typeof data.version).toBe("string");
  });
});
