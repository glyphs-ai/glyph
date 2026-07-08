import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/workflow-db.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
