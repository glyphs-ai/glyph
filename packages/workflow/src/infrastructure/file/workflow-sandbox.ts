import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { WorkflowIdSchema } from "../../domain/workflow/workflow-id.js";

export const WORKFLOW_SUBDIR = "workflows";

export class WorkflowSandbox {
  private readonly root: string;
  private readonly logger: Logger | undefined;

  constructor(opts: { readonly root: string; readonly logger?: Logger }) {
    this.root = path.resolve(opts.root);
    this.logger = opts.logger;
  }

  workflowDir(workflowId: string): string {
    const parsed = WorkflowIdSchema.safeParse(workflowId);
    if (!parsed.success) throw new Error(`invalid workflow id: ${JSON.stringify(workflowId)}`);
    return this.safeJoinUnderRoot(this.root, parsed.data);
  }

  reserve(workflowId: string): ResultAsync<string, unknown> {
    const dir = this.workflowDir(workflowId);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(dir, { recursive: false });
        return dir;
      })(),
      (cause) => cause,
    );
  }

  async remove(workflowId: string): Promise<void> {
    const dir = this.workflowDir(workflowId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger?.warn(
        { path: dir, err },
        "workflow: failed to remove workflowDir during cleanup",
      );
    }
  }

  private safeJoinUnderRoot(root: string, id: string): string {
    if (
      !id ||
      id === "." ||
      id === ".." ||
      id.includes("/") ||
      id.includes("\\") ||
      id.includes("\0")
    ) {
      throw new Error(`invalid workflow path component: ${JSON.stringify(id)}`);
    }
    const normalizedRoot = path.resolve(root);
    const candidate = path.resolve(normalizedRoot, id);
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    if (!candidate.startsWith(rootWithSep) && candidate !== normalizedRoot) {
      throw new Error(
        `refused: candidate path escapes root (${candidate} not under ${rootWithSep})`,
      );
    }
    if (candidate === normalizedRoot) {
      throw new Error("refused: candidate path equals root");
    }
    return candidate;
  }
}

export function workflowRoot(workspaceDir: string): string {
  return path.join(workspaceDir, WORKFLOW_SUBDIR);
}

export function workflowDir(workspaceDir: string, workflowId: string): string {
  return new WorkflowSandbox({ root: workflowRoot(workspaceDir) }).workflowDir(workflowId);
}
