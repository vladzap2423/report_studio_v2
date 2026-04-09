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
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM (
          'new',
          'in_progress',
          'blocked',
          'review',
          'done',
          'canceled'
        );
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
        CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
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
    CREATE TABLE IF NOT EXISTS task_groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_group_members (
      group_id BIGINT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status task_status NOT NULL DEFAULT 'new',
      priority task_priority NOT NULL DEFAULT 'medium',
      creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      comments_count INTEGER NOT NULL DEFAULT 0,
      due_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL DEFAULT 'comment',
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_history (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      old_value JSONB,
      new_value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      group_id BIGINT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      comment_id BIGINT REFERENCES task_comments(id) ON DELETE CASCADE,
      is_seen BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      seen_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    ALTER TABLE services
    ADD COLUMN IF NOT EXISTS name TEXT;
  `);

  await pool.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment';
  `);

  await pool.query(`
    UPDATE task_comments
    SET
      kind = 'transfer',
      body = COALESCE(NULLIF(BTRIM(SPLIT_PART(body, 'Причина:', 2)), ''), body)
    WHERE kind = 'comment'
      AND body LIKE 'Передача задачи:%Причина:%';
  `);

  await pool.query(`
    UPDATE tasks t
    SET comments_count = counts.comments_count
    FROM (
      SELECT task_id, COUNT(*)::int AS comments_count
      FROM task_comments
      GROUP BY task_id
    ) counts
    WHERE counts.task_id = t.id
      AND t.comments_count <> counts.comments_count;
  `);

  await pool.query(`
    UPDATE tasks
    SET comments_count = 0
    WHERE comments_count IS NULL;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_code ON services(code);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_profile ON services(profile);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_groups_active ON task_groups(is_active);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_group_members_user_group ON task_group_members(user_id, group_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_group_status_priority_due ON tasks(group_id, status, priority, due_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_group_assignee_status ON tasks(group_id, assignee_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_group_updated_at ON tasks(group_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_comments_task_created ON task_comments(task_id, created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_history_task_created ON task_history(task_id, created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_notifications_user_seen_group ON task_notifications(user_id, is_seen, group_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_notifications_task_kind ON task_notifications(task_id, kind);`);
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
