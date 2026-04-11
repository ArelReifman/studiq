import "./load-env.js";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { createApp } from "./app.js";

const app = createApp();
app.use("*", logger());

const port = Number(process.env["PORT"] ?? 3001);
console.log(`API running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
