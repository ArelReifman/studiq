import { handle } from "hono/vercel";
import { createApp } from "@studiq/api/app";

const app = createApp("/api");
const handler = handle(app);

// Default Vercel timeout is 10s — Claude calls (report/lesson generation,
// AI profile updates) can take 15–30s, so bump to the platform max.
export const maxDuration = 60;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
