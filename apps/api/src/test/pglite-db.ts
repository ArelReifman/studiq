// In-memory Postgres (pglite) test database.
//
// POC test infrastructure for DB-backed regression tests. The project has no
// SQL migration files (it uses `drizzle-kit push`), so we materialize the live
// Drizzle schema straight into pglite via drizzle-kit's programmatic push.
//
// This file is imported ONLY by test files. Production code keeps using
// db/client.ts (postgres-js → Supabase) untouched.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema.js";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: TestDb | null = null;

/** Spin up a fresh in-memory database and create every table/enum from the
 *  Drizzle schema. Safe to call multiple times — subsequent calls are no-ops. */
export async function initTestDb(): Promise<TestDb> {
  if (_db) return _db;

  const client = new PGlite({ extensions: { vector } });
  // ai_context_vectors.embedding is a pgvector column — register the type.
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");

  const db = drizzle(client, { schema });

  // Programmatic push: diff the empty DB against the schema and apply the DDL.
  const { pushSchema } = await import("drizzle-kit/api");
  const { apply } = await pushSchema(
    schema as unknown as Record<string, unknown>,
    db as never
  );
  await apply();

  _db = db;
  return db;
}

/** Lazy proxy mirroring db/client.ts so tests can `vi.mock` db/client.js to
 *  point here. Throws if used before initTestDb(). */
export const testDb = new Proxy({} as TestDb, {
  get(_target, prop) {
    if (!_db)
      throw new Error("testDb not initialized — call initTestDb() in beforeAll");
    return (_db as never)[prop as never];
  },
});
