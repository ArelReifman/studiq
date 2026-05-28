/**
 * Cron-protected routes.
 *
 * Vercel Cron invokes these on a schedule (see vercel.json `crons` block)
 * with an `Authorization: Bearer <CRON_SECRET>` header. The shared secret
 * is set in the Vercel project env (`CRON_SECRET`) and matches what we
 * compare here. Requests without a matching secret get 401.
 *
 * In Phase 3B-1 the only route is `/sync-calendar`, which delegates to the
 * worker. The worker is a no-op while no flow writes `pending` rows yet,
 * so calling this route in production has zero user-visible effect.
 */

import { Hono } from "hono";
import { runCalendarSyncBatch } from "../services/calendar-sync-worker.js";

export const cronRoutes = new Hono()
  // Shared-secret gate. Applied to every route in this file.
  .use("*", async (c, next) => {
    const expected = process.env["CRON_SECRET"];
    if (!expected) {
      // Misconfigured deploy — fail closed rather than expose an unguarded
      // endpoint. Log so the operator notices immediately.
      console.error("[cron] CRON_SECRET is not set — refusing all requests");
      return c.json({ error: "Cron not configured" }, 503);
    }
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  })

  // GET /cron/sync-calendar — run one worker batch.
  // Returns immediately when there are no pending rows.
  .get("/sync-calendar", async (c) => {
    const startedAt = Date.now();
    const result = await runCalendarSyncBatch();
    return c.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      ...result,
    });
  });
