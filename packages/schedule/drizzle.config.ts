import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/schedule-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
