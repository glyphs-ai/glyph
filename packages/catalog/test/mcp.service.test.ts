import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpService } from "../src/application/mcp.service.js";
import { McpNotFoundError, McpOriginConflictError } from "../src/contract/mcp.errors.js";
import { McpEntity } from "../src/domain/mcp.entity.js";
import { McpNameInvalidError } from "../src/domain/mcp.errors.js";
import * as McpFormat from "../src/domain/mcp.format.js";
import { McpRepository } from "../src/persistence/mcp.repository.js";
import { bootstrapCatalogDb } from "./helpers/bootstrap.js";

/**
 * The McpService contract is repository-agnostic. Set up as a backend
 * matrix so future repository implementations can be swapped in by
 * adding a row to `BACKENDS` — no fixture duplication.
 */
type Backend = {
  readonly name: string;
  readonly setup: () => Promise<{ repo: McpRepository; teardown: () => Promise<void> }>;
};

const BACKENDS: Backend[] = [
  {
    name: "McpRepository (in-memory)",
    setup: async () => {
      const orm = bootstrapCatalogDb();

      const repo = new McpRepository({ db: orm.db });
      return {
        repo,
        teardown: async () => {
          orm.close();
        },
      };
    },
  },
];

for (const backend of BACKENDS) {
  describe(`McpService over ${backend.name}`, () => {
    let repo: McpRepository;
    let teardown: () => Promise<void>;
    let fetchStub: ReturnType<typeof vi.fn<(origin: string) => Promise<string>>>;
    let svc: McpService;

    beforeEach(async () => {
      const setup = await backend.setup();
      repo = setup.repo;
      teardown = setup.teardown;
      fetchStub = vi.fn<(origin: string) => Promise<string>>();
      svc = new McpService({ repo, fetcher: (origin) => fetchStub(origin) });
    });

    afterEach(async () => {
      await teardown();
    });

    describe("install", () => {
      it("persists a new entity", async () => {
        const m = await svc.install("azure/mcp", "file:/abs/azure", '{"command":"node"}');
        expect(m).toBeInstanceOf(McpEntity);
        expect(m.fqn).toBe("azure/mcp");
        expect(m.origin).toBe("file:///abs/azure");
        expect(await svc.has("azure/mcp")).toBe(true);
        expect(await svc.list()).toHaveLength(1);
      });

      it("injects _meta.name into the stored content (origin lives on the entity, not in the file)", async () => {
        await svc.install("azure/mcp", "file:/abs/azure", '{"command":"node","args":["s.js"]}');
        const content = await svc.getContent("azure/mcp");
        const { meta, body } = McpFormat.parse(content, "test");
        expect(meta).toEqual({ name: "azure/mcp" });
        expect(body.command).toBe("node");
      });

      it("preserves foreign _meta keys when input already carries _meta", async () => {
        const input = JSON.stringify({
          command: "node",
          _meta: {
            name: "old/name",
            origin: "file:/abs/old",
            "io.modelcontextprotocol.registry/extra": { tag: "v1" },
          },
        });
        await svc.install("new/name", "file:/abs/new", input);
        const stored = await svc.getContent("new/name");
        const { meta, body } = McpFormat.parse(stored, "test");
        expect(meta).toEqual({ name: "new/name" });
        expect(
          (body._meta as Record<string, unknown>)["io.modelcontextprotocol.registry/extra"],
        ).toEqual({
          tag: "v1",
        });
      });

      it("rejects invalid names", async () => {
        await expect(svc.install("no-slash-name", "file:/abs/x", "{}")).rejects.toThrow(
          McpNameInvalidError,
        );
        await expect(svc.install("two/slashes/here", "file:/abs/x", "{}")).rejects.toThrow(
          McpNameInvalidError,
        );
        await expect(svc.install("/leading", "file:/abs/x", "{}")).rejects.toThrow(
          McpNameInvalidError,
        );
      });

      it("rejects empty origin", async () => {
        await expect(svc.install("x/y", "", "{}")).rejects.toThrow();
      });

      it("allows reinstall under the same origin (upsert)", async () => {
        await svc.install("x/y", "file:/abs/x", '{"v":1}');
        await svc.install("x/y", "file:/abs/x", '{"v":2}');
        const content = await svc.getContent("x/y");
        expect(JSON.parse(content).v).toBe(2);
      });

      it("rejects reinstall with a different origin", async () => {
        await svc.install("x/y", "file:/abs/x", '{"v":1}');
        await expect(svc.install("x/y", "file:/abs/other", '{"v":2}')).rejects.toThrow(
          McpOriginConflictError,
        );
      });

      it("does not corrupt storage on a failed install", async () => {
        await expect(svc.install("x/y", "file:/abs/x", "{not json")).rejects.toThrow();
        expect(await svc.has("x/y")).toBe(false);
        expect(await repo.findById("x/y")).toBeUndefined();
      });
    });

    describe("installFromOrigin", () => {
      it("dispatches to the fetcher and installs the returned content", async () => {
        fetchStub.mockResolvedValueOnce('{"command":"node"}');
        const m = await svc.installFromOrigin("azure/mcp", "file:/abs/azure");
        expect(m.origin).toBe("file:///abs/azure");
        expect(await svc.has("azure/mcp")).toBe(true);
        expect(fetchStub).toHaveBeenCalledWith("file:/abs/azure");
      });

      it("propagates fetcher errors as-is", async () => {
        fetchStub.mockRejectedValueOnce(new Error("upstream 404"));
        await expect(svc.installFromOrigin("x/y", "file:/abs/x")).rejects.toThrow(/upstream 404/);
      });
    });

    describe("delete", () => {
      it("removes from storage", async () => {
        await svc.install("x/y", "file:/abs/x", "{}");
        await svc.delete("x/y");
        expect(await svc.has("x/y")).toBe(false);
        expect(await repo.findById("x/y")).toBeUndefined();
      });

      it("throws NotFound when deleting a missing entry", async () => {
        await expect(svc.delete("never/existed")).rejects.toThrow(McpNotFoundError);
      });

      it("allows reinstall after delete (no zombie)", async () => {
        await svc.install("x/y", "file:/abs/first", '{"v":1}');
        await svc.delete("x/y");
        await svc.install("x/y", "file:/abs/second", '{"v":2}');
        const m = await svc.get("x/y");
        expect(m!.origin).toBe("file:///abs/second");
        expect(JSON.parse(m!.spec).v).toBe(2);
      });
    });

    describe("get / list", () => {
      it("returns null for absent entry", async () => {
        expect(await svc.get("missing/x")).toBeNull();
      });

      it("get returns a McpEntity entity", async () => {
        await svc.install("x/y", "file:/abs/x", "{}");
        const m = await svc.get("x/y");
        expect(m).toBeInstanceOf(McpEntity);
        expect(m!.fqn).toBe("x/y");
      });

      it("getByOrigin normalizes the input so cross-separator file: lookups match", async () => {
        await svc.install("x/y", "file:/abs/x", "{}");
        expect((await svc.getByOrigin("file:///abs/x"))?.fqn).toBe("x/y");
        expect((await svc.getByOrigin("file:/abs/x/"))?.fqn).toBe("x/y");
      });

      it("getByOrigin returns null without throwing on garbage input", async () => {
        await svc.install("x/y", "file:/abs/x", "{}");
        expect(await svc.getByOrigin("not-a-valid-origin")).toBeNull();
        expect(await svc.getByOrigin("")).toBeNull();
      });

      it("list reflects install / delete in real time", async () => {
        expect(await svc.list()).toHaveLength(0);
        await svc.install("a/x", "file:/abs/a", "{}");
        await svc.install("b/y", "file:/abs/b", "{}");
        expect(await svc.list()).toHaveLength(2);
        await svc.delete("a/x");
        expect(await svc.list()).toHaveLength(1);
      });
    });
  });
}
