import type { Logger } from "pino";
import { describe, expectTypeOf, it } from "vitest";
import {
  type CreateScheduleError,
  type CreateScheduleRequest,
  type CreateScheduleResponse,
  type CreateScheduleUseCase,
  composeScheduleModule,
  type DatabaseUnavailable,
  type DeleteScheduleError,
  type DeleteScheduleRequest,
  type DeleteScheduleResponse,
  type DeleteScheduleUseCase,
  type DrizzleScheduleQueries,
  type DrizzleScheduleRepository,
  describeCron,
  type GetScheduleRequest,
  type GetScheduleResponse,
  type GetScheduleUseCase,
  generateScheduleId,
  type InvalidCronExpr,
  type InvalidJsonPath,
  type InvalidScheduleId,
  type InvalidScheduleKindName,
  type InvalidScheduleName,
  type InvalidTimezone,
  type ListSchedulesError,
  type ListSchedulesRequest,
  type ListSchedulesUseCase,
  nextRuns,
  type PatchScheduleError,
  type PatchScheduleRequest,
  type PatchScheduleUseCase,
  type PreviewCountOutOfRange,
  type PreviewScheduleRequest,
  type PreviewScheduleResponse,
  type PreviewScheduleUseCase,
  type RunScheduleRequest,
  type RunScheduleResponse,
  type RunScheduleUseCase,
  type ScheduleEnabled,
  type ScheduleEngine,
  type ScheduleEntity,
  type ScheduleHasInFlight,
  type ScheduleId,
  ScheduleIdSchema,
  type ScheduleKindAlreadyRegistered,
  type ScheduleKindHandler,
  type ScheduleKindMismatch,
  type ScheduleKindNotRegistered,
  type ScheduleKindRegistryFrozen,
  type ScheduleModule,
  type ScheduleModuleOptions,
  type ScheduleNotFound,
  type ScheduleRepository,
  type ScheduleTargetEnvelope,
  ScheduleTargetEnvelopeSchema,
  type ScheduleTrigger,
  ScheduleTriggerSchema,
  type TargetValidationFailed,
  validateCron,
  validateTimezone,
} from "../src/index.js";

describe("@glyphs-ai/schedule public API guard", () => {
  it("preserves the public DTO shapes", () => {
    expectTypeOf<CreateScheduleRequest>().toHaveProperty("name");
    expectTypeOf<CreateScheduleRequest>().toHaveProperty("trigger");
    expectTypeOf<CreateScheduleRequest>().toHaveProperty("target");
    expectTypeOf<CreateScheduleResponse>().toHaveProperty("id");
    expectTypeOf<GetScheduleRequest>().toHaveProperty("id");
    expectTypeOf<GetScheduleResponse>().toEqualTypeOf<CreateScheduleResponse | null>();
    expectTypeOf<ListSchedulesRequest>().toHaveProperty("enabled");
    expectTypeOf<PatchScheduleRequest>().toHaveProperty("expectedKind");
    expectTypeOf<DeleteScheduleRequest>().toHaveProperty("id");
    expectTypeOf<DeleteScheduleResponse>().toHaveProperty("deletedDispatchCount");
    expectTypeOf<RunScheduleRequest>().toHaveProperty("id");
    expectTypeOf<RunScheduleResponse>().toHaveProperty("dispatchId");
    expectTypeOf<PreviewScheduleRequest>().toHaveProperty("expr");
    expectTypeOf<PreviewScheduleResponse>().toHaveProperty("nextRuns");
    expectTypeOf<ScheduleTargetEnvelope>().toHaveProperty("kind");
    expectTypeOf<ScheduleTargetEnvelope>().toHaveProperty("data");
    expectTypeOf<ScheduleTrigger>().toHaveProperty("kind");
    expectTypeOf<ScheduleTrigger>().toHaveProperty("expr");
    expectTypeOf<ScheduleTrigger>().toHaveProperty("tz");
  });

  it("preserves the Result-native error atom surface", () => {
    expectTypeOf<InvalidScheduleId>().toHaveProperty("type");
    expectTypeOf<InvalidCronExpr>().toHaveProperty("reason");
    expectTypeOf<InvalidTimezone>().toHaveProperty("tz");
    expectTypeOf<InvalidJsonPath>().toHaveProperty("path");
    expectTypeOf<InvalidScheduleName>().toHaveProperty("type");
    expectTypeOf<InvalidScheduleKindName>().toHaveProperty("type");
    expectTypeOf<ScheduleEnabled>().toHaveProperty("id");
    expectTypeOf<ScheduleHasInFlight>().toHaveProperty("id");
    expectTypeOf<ScheduleKindMismatch>().toHaveProperty("expected");
    expectTypeOf<ScheduleKindNotRegistered>().toHaveProperty("kind");
    expectTypeOf<TargetValidationFailed>().toHaveProperty("cause");
    expectTypeOf<ScheduleNotFound>().toHaveProperty("id");
    expectTypeOf<DatabaseUnavailable>().toHaveProperty("cause");
    expectTypeOf<PreviewCountOutOfRange>().toHaveProperty("n");
    expectTypeOf<CreateScheduleError>().toHaveProperty("type");
    expectTypeOf<PatchScheduleError>().toHaveProperty("type");
    expectTypeOf<DeleteScheduleError>().toHaveProperty("type");
    expectTypeOf<ListSchedulesError>().toHaveProperty("type");
  });

  it("preserves the open-registry handler port and lifecycle error atoms", () => {
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("validate");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("mergePatch");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("dispatch");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("hasInFlightForSchedule");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("deleteForSchedule");
    expectTypeOf<ScheduleKindAlreadyRegistered>().toHaveProperty("type");
    expectTypeOf<ScheduleKindNotRegistered>().toHaveProperty("type");
    expectTypeOf<ScheduleKindRegistryFrozen>().toHaveProperty("type");
  });

  it("preserves the domain + infrastructure helpers", () => {
    expectTypeOf(generateScheduleId).toBeFunction();
    expectTypeOf<ScheduleId>().toBeString();
    expectTypeOf(ScheduleIdSchema).toHaveProperty("parse");
    expectTypeOf(validateCron).toBeFunction();
    expectTypeOf(validateTimezone).toBeFunction();
    expectTypeOf(nextRuns).returns.toEqualTypeOf<string[]>();
    expectTypeOf(describeCron).toBeFunction();
    expectTypeOf(ScheduleTargetEnvelopeSchema).toHaveProperty("parse");
    expectTypeOf(ScheduleTriggerSchema).toHaveProperty("parse");
    expectTypeOf<typeof ScheduleEntity>().toHaveProperty("create");
    expectTypeOf<typeof ScheduleEntity>().toHaveProperty("rehydrate");
    expectTypeOf<ScheduleRepository>().toHaveProperty("get");
    expectTypeOf<typeof DrizzleScheduleRepository>().toHaveProperty("prototype");
    expectTypeOf<typeof DrizzleScheduleQueries>().toHaveProperty("prototype");
  });

  it("preserves the composition surface", () => {
    expectTypeOf(composeScheduleModule).parameters.toEqualTypeOf<[ScheduleModuleOptions]>();
    expectTypeOf(composeScheduleModule).returns.resolves.toEqualTypeOf<ScheduleModule>();
    expectTypeOf<ScheduleModuleOptions>().toMatchTypeOf<{ readonly logger?: Logger }>();
    expectTypeOf<ScheduleModule>().toHaveProperty("engine");
    expectTypeOf<ScheduleModule>().toHaveProperty("close");
    expectTypeOf<ScheduleModule>().toHaveProperty("createSchedule");
    expectTypeOf<ScheduleModule>().toHaveProperty("patchSchedule");
    expectTypeOf<ScheduleModule>().toHaveProperty("deleteSchedule");
    expectTypeOf<ScheduleModule>().toHaveProperty("runSchedule");
    expectTypeOf<ScheduleModule>().toHaveProperty("getSchedule");
    expectTypeOf<ScheduleModule>().toHaveProperty("listSchedules");
    expectTypeOf<ScheduleModule>().toHaveProperty("previewSchedule");
  });

  it("read + write use-cases expose an execute(request) method", () => {
    expectTypeOf<CreateScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<PatchScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<DeleteScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<RunScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<GetScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<ListSchedulesUseCase>().toHaveProperty("execute");
    expectTypeOf<PreviewScheduleUseCase>().toHaveProperty("execute");
    expectTypeOf<ScheduleEngine>().toHaveProperty("registerKind");
    expectTypeOf<ScheduleEngine>().toHaveProperty("recover");
    expectTypeOf<ScheduleEngine>().toHaveProperty("shutdown");
    expectTypeOf<ScheduleEngine>().toHaveProperty("arm");
    expectTypeOf<ScheduleEngine>().toHaveProperty("cancel");
  });
});
