import { handle } from "hono/vercel";
import { createApp } from "@studiq/api/app";

const app = createApp("/api");
const handler = handle(app);

// Default Vercel timeout is 10s — Claude calls (report/lesson generation,
// AI profile updates) can take longer, and Sonnet-based lesson generation can
// run well past 60s, so raise this to the project's configured ceiling (300s).
export const maxDuration = 300;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
