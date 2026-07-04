/**
 * Compile-time public API guard for `@glyphs-ai/workflow`.
 *
 * Uses Vitest's `expectTypeOf<T>()` to lock the package's public surface at the
 * TYPE level: the composition entrypoint, the module's use-case container + the
 * engine seam, the runner port, the entity classes, the closed enum
 * vocabularies, the id generators + path helpers, and the retry-metadata
 * surface. A silent rename / removal / DTO-field drift fails
 * `pnpm --filter @glyphs-ai/workflow typecheck` before any downstream consumer
 * notices. `expectTypeOf` is a no-op at runtime; the real check is tsc.
 */

import { describe, expectTypeOf, it } from "vitest";
import {
  composeWorkflowModule,
  extractWorkflowNodeRetryMetadata,
  generateWorkflowId,
  generateWorkflowNodeId,
  type NodeRef,
  STUCK_RETRY_MAX_ATTEMPTS,
  type WorkflowDagSnapshot,
  type WorkflowEdgeEntity,
  type WorkflowEntity,
  type WorkflowModule,
  type WorkflowModuleOptions,
  type WorkflowNodeDispatchOpts,
  type WorkflowNodeEntity,
  type WorkflowNodeKind,
  type WorkflowNodeRetryMetadata,
  type WorkflowNodeRetryReason,
  type WorkflowNodeRunner,
  type WorkflowNodeStatus,
  type WorkflowNodeTerminalResult,
  type WorkflowNodeValidateCtx,
  type WorkflowRunners,
  type WorkflowStatus,
  workflowDir,
  workflowRoot,
} from "../src/index.js";

describe("@glyphs-ai/workflow public API guard", () => {
  it("preserves the FSM enum vocabularies", () => {
    expectTypeOf<WorkflowStatus>().toEqualTypeOf<
      "running" | "succeeded" | "failed" | "cancelled"
    >();
    expectTypeOf<WorkflowNodeStatus>().toEqualTypeOf<
      "not_started" | "ready" | "running" | "succeeded" | "failed" | "cancelled"
    >();
  });

  it("locks the closed WorkflowNodeKind enum to {'coordinator', 'worker', 'human'}", () => {
    expectTypeOf<WorkflowNodeKind>().toEqualTypeOf<"coordinator" | "worker" | "human">();
  });

  it("preserves the runner port interface", () => {
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("validate");
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("dispatch");
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("hasInFlightForNode");
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("cancel");
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("listArtifacts");
    expectTypeOf<WorkflowNodeRunner>().toHaveProperty("resolveArtifactPath");

    expectTypeOf<WorkflowNodeValidateCtx>().toHaveProperty("workflowId");
    expectTypeOf<WorkflowNodeValidateCtx>().toHaveProperty("workflowStatus");
    expectTypeOf<WorkflowNodeValidateCtx>().toHaveProperty("coordinatorAgent");
  });

  it("exposes WorkflowNodeTerminalResult as a three-arm discriminated union", () => {
    expectTypeOf<WorkflowNodeTerminalResult>().toEqualTypeOf<
      | { readonly status: "succeeded"; readonly output?: unknown }
      | { readonly status: "failed"; readonly reason: string; readonly output?: unknown }
      | { readonly status: "cancelled"; readonly reason: string }
    >();
  });

  it("dispatch opts carry workflowId / nodeId / spec / onTerminal (no nodeDir)", () => {
    type DispatchParam = Parameters<WorkflowNodeRunner["dispatch"]>[0];
    expectTypeOf<DispatchParam>().toEqualTypeOf<WorkflowNodeDispatchOpts>();
    expectTypeOf<DispatchParam>().toHaveProperty("workflowId");
    expectTypeOf<DispatchParam>().toHaveProperty("nodeId");
    expectTypeOf<DispatchParam>().toHaveProperty("spec");
    expectTypeOf<DispatchParam>().toHaveProperty("onTerminal");
    expectTypeOf<DispatchParam>().not.toHaveProperty("nodeDir");
    expectTypeOf<DispatchParam["onTerminal"]>().toEqualTypeOf<
      (result: WorkflowNodeTerminalResult) => void
    >();
  });

  it("requires a runner per WorkflowNodeKind via WorkflowRunners", () => {
    expectTypeOf<WorkflowRunners>().toHaveProperty("coordinator");
    expectTypeOf<WorkflowRunners>().toHaveProperty("worker");
    expectTypeOf<WorkflowRunners>().toHaveProperty("human");
    expectTypeOf<WorkflowRunners["coordinator"]>().toEqualTypeOf<WorkflowNodeRunner>();
    expectTypeOf<WorkflowRunners["worker"]>().toEqualTypeOf<WorkflowNodeRunner>();
    expectTypeOf<WorkflowRunners["human"]>().toEqualTypeOf<WorkflowNodeRunner>();
  });

  it("preserves the id generators", () => {
    expectTypeOf(generateWorkflowId).toBeFunction();
    expectTypeOf(generateWorkflowNodeId).toBeFunction();
    expectTypeOf(generateWorkflowId).returns.toBeString();
    expectTypeOf(generateWorkflowNodeId).returns.toBeString();
  });

  it("preserves the exported path helpers", () => {
    expectTypeOf(workflowDir).toBeFunction();
    expectTypeOf(workflowRoot).toBeFunction();
    expectTypeOf(workflowDir).returns.toBeString();
    expectTypeOf(workflowRoot).returns.toBeString();
  });

  it("exposes the retry-metadata surface + stuck-retry cap", () => {
    expectTypeOf<WorkflowNodeRetryReason>().toEqualTypeOf<
      "coord_exited_without_action" | "workers_finished_without_coord"
    >();
    expectTypeOf<WorkflowNodeRetryMetadata>().toHaveProperty("of");
    expectTypeOf<WorkflowNodeRetryMetadata>().toHaveProperty("reason");
    expectTypeOf<WorkflowNodeRetryMetadata>().toHaveProperty("attempt");
    expectTypeOf(extractWorkflowNodeRetryMetadata).toBeFunction();
    expectTypeOf(STUCK_RETRY_MAX_ATTEMPTS).toBeNumber();
  });

  it("preserves the entity classes (create / reconstitute — mapper owns row mapping)", () => {
    expectTypeOf<typeof WorkflowEntity>().toHaveProperty("create");
    expectTypeOf<typeof WorkflowEntity>().toHaveProperty("reconstitute");
    expectTypeOf<typeof WorkflowNodeEntity>().toHaveProperty("create");
    expectTypeOf<typeof WorkflowNodeEntity>().toHaveProperty("reconstitute");
    expectTypeOf<typeof WorkflowEdgeEntity>().toHaveProperty("create");
  });

  it("NodeRef is a discriminated union over the existing | temp tag", () => {
    expectTypeOf<NodeRef["kind"]>().toEqualTypeOf<"existing" | "temp">();
    expectTypeOf<{ readonly kind: "temp"; readonly tempId: string }>().toExtend<NodeRef>();
  });

  it("WorkflowDagSnapshot pins the header + nodes + edges shape", () => {
    expectTypeOf<WorkflowDagSnapshot>().toHaveProperty("workflow");
    expectTypeOf<WorkflowDagSnapshot>().toHaveProperty("nodes");
    expectTypeOf<WorkflowDagSnapshot>().toHaveProperty("edges");
  });

  it("preserves the composition surface (composeWorkflowModule + options)", () => {
    expectTypeOf(composeWorkflowModule).parameters.toEqualTypeOf<[WorkflowModuleOptions]>();
    expectTypeOf(composeWorkflowModule).returns.resolves.toEqualTypeOf<WorkflowModule>();
    expectTypeOf<WorkflowModuleOptions>().toHaveProperty("workspaceDir");
    expectTypeOf<WorkflowModuleOptions>().toHaveProperty("runners");
  });

  it("WorkflowModule is a use-case container plus the engine seam (no service facade)", () => {
    // Read + write use-case instances are exposed directly; there is no
    // `service` facade in the CQRS layout.
    expectTypeOf<WorkflowModule>().not.toHaveProperty("service");
    expectTypeOf<WorkflowModule>().toHaveProperty("engine");
    expectTypeOf<WorkflowModule>().toHaveProperty("close");
    for (const key of [
      "createWorkflow",
      "deleteWorkflow",
      "cancelNode",
      "finishWorkflow",
      "cancelWorkflow",
      "addSubgraph",
      "respondHumanNode",
      "getWorkflow",
      "listWorkflows",
      "getDag",
      "getNode",
      "countAwaitingHuman",
      "aggregateByOrigin",
    ] as const) {
      expectTypeOf<WorkflowModule>().toHaveProperty(key);
    }
  });

  it("read + write use-cases expose an execute(request) method", () => {
    expectTypeOf<WorkflowModule["createWorkflow"]>().toHaveProperty("execute");
    expectTypeOf<WorkflowModule["addSubgraph"]>().toHaveProperty("execute");
    expectTypeOf<WorkflowModule["getDag"]>().toHaveProperty("execute");
    expectTypeOf<WorkflowModule["listWorkflows"]>().toHaveProperty("execute");
  });
});
