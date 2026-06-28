import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { __Entity__Service } from "../../src/application/__entity-kebab__.service.js";
import { __Entity__NotFoundError } from "../../src/contract/__entity-kebab__.errors.js";
import type { __Entity__Repository } from "../../src/persistence/__entity-kebab__.repository.js";
import { a__Entity__ } from "../_fixtures/__entity-kebab__.js";

// Application-layer unit test (London style): the repository is MOCKED so
// the service's orchestration (input validation, id minting, projection,
// not-found handling) is tested in isolation — no database. The real
// repository SQL is covered separately by the persistence integration
// test. Value-imports span application/ + contract/, so this file is
// allow-listed to live in test/application/ (see test-layout-convention).

const FIXED_NOW = new Date("2025-01-01T00:00:00.000Z");

let repo: MockProxy<__Entity__Repository>;
let service: __Entity__Service;

beforeEach(() => {
  repo = mock<__Entity__Repository>();
  service = new __Entity__Service({ repo, now: () => FIXED_NOW });
});

describe("__Entity__Service.get", () => {
  it("rejects a malformed id with ZodError (no repo call)", async () => {
    await expect(service.get("has spaces")).rejects.toBeInstanceOf(ZodError);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("returns null for a valid-but-unknown id", async () => {
    repo.findById.mockResolvedValue(undefined);
    expect(await service.get("unknown")).toBeNull();
  });

  it("returns the entity projected to a DTO", async () => {
    repo.findById.mockResolvedValue(a__Entity__({ id: "abc", name: "Hi" }));
    expect(await service.get("abc")).toMatchObject({ id: "abc", name: "Hi" });
  });
});

describe("__Entity__Service.list", () => {
  it("delegates to the repository", async () => {
    repo.findAll.mockResolvedValue([a__Entity__({ id: "1" }), a__Entity__({ id: "2" })]);
    expect((await service.list()).map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("__Entity__Service.create", () => {
  it("rejects an invalid input with ZodError (no insert)", async () => {
    await expect(service.create({ name: "" })).rejects.toBeInstanceOf(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("mints an id, stamps createdAt from the injected clock, and inserts", async () => {
    repo.insert.mockResolvedValue(undefined);
    const dto = await service.create({ name: "New" });

    expect(dto.name).toBe("New");
    expect(dto.createdAt).toBe(FIXED_NOW.toISOString());
    expect(dto.id).toMatch(/^[0-9a-f]+$/);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New", createdAt: FIXED_NOW.toISOString() }),
    );
  });
});

describe("__Entity__Service.delete", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(service.delete("has spaces")).rejects.toBeInstanceOf(ZodError);
  });

  it("throws __Entity__NotFoundError when the row is absent (no delete)", async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(service.delete("missing")).rejects.toBeInstanceOf(__Entity__NotFoundError);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes an existing row", async () => {
    repo.findById.mockResolvedValue(a__Entity__({ id: "abc" }));
    repo.delete.mockResolvedValue(undefined);
    await service.delete("abc");
    expect(repo.delete).toHaveBeenCalledWith("abc");
  });
});
