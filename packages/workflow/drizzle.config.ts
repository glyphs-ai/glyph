import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/workflow-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
