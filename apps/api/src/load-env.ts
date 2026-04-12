import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// Load from apps/api/.env first, then fallback to root .env
config({ path: resolve(here, "../.env") });
config({ path: resolve(here, "../../../.env") });
