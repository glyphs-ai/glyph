import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/__entity-kebab__-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
