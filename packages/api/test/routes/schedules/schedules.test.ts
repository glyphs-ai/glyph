import type { PreviewScheduleResponse, ScheduleModule } from "@glyphs-ai/schedule";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { schedulesPreviewCronRoutes } from "../../../src/routes/schedules/schedules.js";

// biome-ignore lint/suspicious/noExplicitAny: route tests assert dynamic JSON envelopes
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

function previewResponse(n: number): PreviewScheduleResponse {
  return {
    describe: "every day at 09:00",
    nextRuns: Array.from(
      { length: n },
      (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}T01:00:00.000Z`,
    ),
  };
}

function stubModule(overrides: Partial<Record<keyof ScheduleModule, unknown>>): ScheduleModule {
  return {
    previewSchedule: {
      execute: vi.fn(({ n = 5 }: { expr: string; tz: string; n?: number }) =>
        okAsync(previewResponse(n)),
      ),
    },
    ...overrides,
  } as unknown as ScheduleModule;
}

async function expectValidation400(res: Response, needle?: RegExp) {
  expect(res.status).toBe(400);
  const body = await jsonBody(res);
  expect(body.code).toBeDefined();
  if (needle) expect(JSON.stringify(body)).toMatch(needle);
  return body;
}

describe("schedulesPreviewCronRoutes", () => {
  it("GET / previews an arbitrary cron expression with default n=5", async () => {
    const preview = vi.fn(({ n = 5 }: { expr: string; tz: string; n?: number }) =>
      okAsync(previewResponse(n)),
    );
    const svc = stubModule({ previewSchedule: { execute: preview } });
    const res = await schedulesPreviewCronRoutes(() => svc).request("/?expr=0+9+*+*+*&tz=UTC");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.describe).toBe("every day at 09:00");
    expect(body.nextRuns).toHaveLength(5);
    expect(preview).toHaveBeenCalledWith({ expr: "0 9 * * *", tz: "UTC", n: 5 });
  });

  it("GET /?n=7 forwards n", async () => {
    const svc = stubModule({});
    const res = await schedulesPreviewCronRoutes(() => svc).request(
      "/?expr=*%2F5+*+*+*+*&tz=UTC&n=7",
    );
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).nextRuns).toHaveLength(7);
    expect(svc.previewSchedule.execute).toHaveBeenCalledWith({
      expr: "*/5 * * * *",
      tz: "UTC",
      n: 7,
    });
  });

  it.each([
    ["missing expr", "/?tz=UTC", /expr/],
    ["blank expr", "/?expr=&tz=UTC", /expr/],
    ["missing tz", "/?expr=0+9+*+*+*", /tz/],
  ])("GET / rejects %s", async (_label, path, needle) => {
    const svc = stubModule({ previewSchedule: { execute: vi.fn() } });
    const res = await schedulesPreviewCronRoutes(() => svc).request(path);
    await expectValidation400(res, needle);
    expect(svc.previewSchedule.execute).not.toHaveBeenCalled();
  });

  it.each(["0", "101", "abc"])("GET /?n=%s returns 400", async (n) => {
    const svc = stubModule({ previewSchedule: { execute: vi.fn() } });
    const res = await schedulesPreviewCronRoutes(() => svc).request(
      `/?expr=0+9+*+*+*&tz=UTC&n=${n}`,
    );
    await expectValidation400(res, /n|Number/);
    expect(svc.previewSchedule.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["InvalidCronExpr", { type: "InvalidCronExpr", expr: "bogus", reason: "not a cron" }],
    ["InvalidTimezone", { type: "InvalidTimezone", tz: "Mars/Olympus" }],
  ])("GET / maps %s to 400 with a typed code", async (code, error) => {
    const svc = stubModule({ previewSchedule: { execute: vi.fn(() => errAsync(error)) } });
    const res = await schedulesPreviewCronRoutes(() => svc).request(
      "/?expr=bogus&tz=Mars%2FOlympus",
    );
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe(code);
  });
});
