import { describe, expect, it } from "vitest";
import { McpManifest } from "../../src/domain/mcp-manifest.js";

describe("McpManifest.create", () => {
  it("accepts a client-config with a compliant _meta.name and keeps spec verbatim", () => {
    const spec = '{"_meta":{"name":"azure/mcp"},"command":"npx"}';
    const r = McpManifest.create(JSON.parse(spec), spec);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.name).toBe("azure/mcp");
      expect(r.value.spec).toBe(spec);
    }
  });

  it("rejects a config missing the reserved _meta block", () => {
    const spec = '{"command":"npx"}';
    const r = McpManifest.create(JSON.parse(spec), spec);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.type).toBe("McpManifestInvalid");
  });

  it("rejects an _meta.name that violates the fqn grammar", () => {
    const spec = '{"_meta":{"name":"no-slash"}}';
    const r = McpManifest.create(JSON.parse(spec), spec);
    expect(r.isErr()).toBe(true);
  });
});
