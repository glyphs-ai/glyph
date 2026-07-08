import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/__entity-kebab__-db.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
