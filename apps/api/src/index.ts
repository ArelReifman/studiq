import "./load-env.js";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { createApp } from "./app.js";
import { checkDatabase } from "./db/check.js";

const app = createApp();
app.use("*", logger());

const port = Number(process.env["PORT"] ?? 3001);

// Validate database on startup (non-blocking warning)
checkDatabase().then((result) => {
  if (!result.ok) {
    console.warn("⚠️  Database issues detected:");
    if (result.errors.length) console.warn("   Errors:", result.errors);
    if (result.missing.length) {
      console.warn("   Missing tables:", result.missing);
      console.warn('   Fix: pnpm --filter @studiq/api db:push');
    }
  } else {
    console.log("✅ Database schema verified.");
  }
});

console.log(`API running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
