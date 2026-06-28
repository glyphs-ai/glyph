import type { Config } from "drizzle-kit";

export default {
  schema: "./src/persistence/tables.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
