import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }

    const isPooler = connectionString.includes("pooler.supabase.com");
    const queryClient = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: !isPooler, // Disable prepared statements for Supabase pooler (transaction mode)
    });

    _db = drizzle(queryClient, { schema });
  }
  return _db;
}

// Lazy proxy: db is accessed as if it's a drizzle instance, but initializes on first use
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export type Db = ReturnType<typeof drizzle<typeof schema>>;
