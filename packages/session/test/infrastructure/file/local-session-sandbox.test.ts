import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionIdSchema } from "../../../src/domain/session-id.js";
import {
  LocalSessionSandbox,
  sessionsRoot,
} from "../../../src/infrastructure/file/local-session-sandbox.js";

const ID = SessionIdSchema.parse("20260508-aaaaaaaa");

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("sessionsRoot", () => {
  it("joins the workspace dir with the `sessions` subdir", () => {
    expect(sessionsRoot(path.join("/ws", "alpha"))).toBe(path.join("/ws", "alpha", "sessions"));
  });
});

describe("LocalSessionSandbox", () => {
  let workspaceDir: string;
  let root: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), "glyph-sandbox-"));
    root = sessionsRoot(workspaceDir);
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  describe("resolve", () => {
    it("returns an absolute path under the sandbox root", () => {
      const sandbox = new LocalSessionSandbox({ root });
      const dir = sandbox.resolve(ID);
      expect(path.isAbsolute(dir)).toBe(true);
      expect(dir).toBe(path.join(path.resolve(root), ID));
    });

    it("is pure — does not touch the filesystem", async () => {
      const sandbox = new LocalSessionSandbox({ root });
      const dir = sandbox.resolve(ID);
      expect(await exists(dir)).toBe(false);
    });
  });

  describe("create", () => {
    it("provisions the per-session directory and returns its path", async () => {
      await mkdir(root, { recursive: true });
      const sandbox = new LocalSessionSandbox({ root });
      const res = await sandbox.create(ID);
      const dir = res._unsafeUnwrap();
      expect(dir).toBe(sandbox.resolve(ID));
      expect(await exists(dir)).toBe(true);
    });

    it("fails with SandboxProvisionFailed when the sandbox root is missing", async () => {
      // `root` is not created — mkdir with recursive:false cannot make the parent.
      const sandbox = new LocalSessionSandbox({ root });
      const err = (await sandbox.create(ID))._unsafeUnwrapErr();
      expect(err.type).toBe("SandboxProvisionFailed");
      expect(err.cause).toBeInstanceOf(Error);
    });

    it("fails with SandboxProvisionFailed when the sandbox already exists", async () => {
      await mkdir(root, { recursive: true });
      const sandbox = new LocalSessionSandbox({ root });
      (await sandbox.create(ID))._unsafeUnwrap();
      const err = (await sandbox.create(ID))._unsafeUnwrapErr();
      expect(err.type).toBe("SandboxProvisionFailed");
    });
  });

  describe("remove", () => {
    it("removes an existing sandbox", async () => {
      await mkdir(root, { recursive: true });
      const sandbox = new LocalSessionSandbox({ root });
      const dir = (await sandbox.create(ID))._unsafeUnwrap();
      (await sandbox.remove(ID))._unsafeUnwrap();
      expect(await exists(dir)).toBe(false);
    });

    it("is idempotent — removing an absent sandbox succeeds", async () => {
      await mkdir(root, { recursive: true });
      const sandbox = new LocalSessionSandbox({ root });
      expect((await sandbox.remove(ID)).isOk()).toBe(true);
    });
  });
});
