import "server-only";
import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { hashPassword } from "@/lib/password";

declare global {
  // eslint-disable-next-line no-var
  var __rsPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __rsDbInitPromise: Promise<void> | undefined;
}

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.PG_USER;
  const password = process.env.PG_PASSWORD;
  const dbName = process.env.PG_DB;
  const port = process.env.PG_PORT || "5432";

  if (!user || !password || !dbName) {
    throw new Error("DATABASE_URL or PG_USER/PG_PASSWORD/PG_DB env vars are required");
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${port}/${encodeURIComponent(dbName)}`;
}

const connectionString = buildConnectionString();

export const pool =
  global.__rsPgPool ||
  new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__rsPgPool = pool;
}

async function createSchema() {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('user', 'admin', 'god');
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role user_role NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      code TEXT,
      name TEXT,
      med INTEGER NOT NULL DEFAULT 0,
      profile TEXT REFERENCES profiles(name) ON UPDATE CASCADE ON DELETE SET NULL
    );
  `);

  await pool.query(`
    ALTER TABLE services
    ADD COLUMN IF NOT EXISTS name TEXT;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_code ON services(code);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_profile ON services(profile);`);
}

async function seedDefaultGodUser() {
  const defaultName =
    process.env.SEED_ADMIN_NAME || "\u0410\u0434\u043c\u0438\u043d\u0438\u0442\u0440\u0430\u0442\u043e\u0440";
  const defaultUsername = process.env.SEED_ADMIN_USERNAME || "admingp1";
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD || "Zx44tfW";

  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [defaultUsername]
  );

  if ((existing.rowCount || 0) > 0) return;

  const passwordHash = await hashPassword(defaultPassword);
  await pool.query(
    `
      INSERT INTO users(name, username, password, role)
      VALUES ($1, $2, $3, 'god')
    `,
    [defaultName, defaultUsername, passwordHash]
  );
}

async function initializeDatabase() {
  await createSchema();
  await seedDefaultGodUser();
}

export async function ensureDatabaseReady() {
  if (!global.__rsDbInitPromise) {
    global.__rsDbInitPromise = initializeDatabase();
  }
  return global.__rsDbInitPromise;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  await ensureDatabaseReady();
  return pool.query<T>(sql, params);
}
