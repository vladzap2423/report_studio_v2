import "server-only";

import path from "path";
import { promises as fs } from "fs";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { ensureDatabaseReady, pool } from "@/lib/db";

export type CatalogBackupInfo = {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  name: string;
};

type ServiceRow = {
  id: string;
  code: string | null;
  name: string | null;
  med: number;
  profile: string | null;
};

type CatalogBackupPayload = {
  version: 1;
  kind: "services_profiles";
  exportedAt: string;
  profiles: { id: number; name: string }[];
  services: { id: number; code: string | null; name: string | null; med: number; profile: string | null }[];
};

const CATALOG_BACKUP_DIR = path.join(process.cwd(), "storage", "db-backups", "catalog");
const SAFE_CATALOG_FILE_RE = /^catalog__(manual|pre_restore)__[0-9]{8}_[0-9]{6}__services_profiles\.json$/i;

function formatTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") +
    "_" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

async function ensureCatalogBackupDir() {
  await fs.mkdir(CATALOG_BACKUP_DIR, { recursive: true });
}

function getCatalogBackupFilePath(fileName: string) {
  if (!SAFE_CATALOG_FILE_RE.test(fileName)) {
    throw new Error("РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ РёРјСЏ backup-С„Р°Р№Р»Р° СЃРїСЂР°РІРѕС‡РЅРёРєРѕРІ.");
  }
  return path.join(CATALOG_BACKUP_DIR, fileName);
}

export function getCatalogBackupStorageDir() {
  return CATALOG_BACKUP_DIR;
}

export async function listCatalogBackups(): Promise<CatalogBackupInfo[]> {
  await ensureCatalogBackupDir();
  const entries = await fs.readdir(CATALOG_BACKUP_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && SAFE_CATALOG_FILE_RE.test(entry.name));

  const backups = await Promise.all(
    files.map(async (entry) => {
      const stat = await fs.stat(path.join(CATALOG_BACKUP_DIR, entry.name));
      return {
        fileName: entry.name,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      } satisfies CatalogBackupInfo;
    })
  );

  backups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return backups;
}

async function buildCatalogBackupPayload(): Promise<CatalogBackupPayload> {
  await ensureDatabaseReady();

  const [profilesRes, servicesRes] = await Promise.all([
    pool.query<ProfileRow>(`SELECT id::text, name FROM profiles ORDER BY name ASC`),
    pool.query<ServiceRow>(
      `
        SELECT id::text, code, name, med, profile
        FROM services
        ORDER BY COALESCE(code, ''), COALESCE(name, '')
      `
    ),
  ]);

  return {
    version: 1,
    kind: "services_profiles",
    exportedAt: new Date().toISOString(),
    profiles: profilesRes.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
    })),
    services: servicesRes.rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      med: Number(row.med) || 0,
      profile: row.profile,
    })),
  };
}

async function createCatalogBackupInternal(kind: "manual" | "pre_restore") {
  await ensureCatalogBackupDir();
  const payload = await buildCatalogBackupPayload();
  const fileName = `catalog__${kind}__${formatTimestamp(new Date())}__services_profiles.json`;
  const filePath = path.join(CATALOG_BACKUP_DIR, fileName);

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  const stat = await fs.stat(filePath);

  return {
    fileName,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  } satisfies CatalogBackupInfo;
}

export async function createCatalogBackup() {
  return createCatalogBackupInternal("manual");
}

function validateCatalogPayload(payload: unknown): asserts payload is CatalogBackupPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ backup-С„Р°Р№Р»Р°.");
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== "services_profiles") {
    throw new Error("Backup-С„Р°Р№Р» РЅРµ РѕС‚РЅРѕСЃРёС‚СЃСЏ Рє СЃРїСЂР°РІРѕС‡РЅРёРєР°Рј services/profiles.");
  }
  if (!Array.isArray(record.profiles) || !Array.isArray(record.services)) {
    throw new Error("Backup-С„Р°Р№Р» РїРѕРІСЂРµР¶РґРµРЅ: РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ profiles РёР»Рё services.");
  }
}

export async function deleteCatalogBackup(fileName: string) {
  const filePath = getCatalogBackupFilePath(fileName);
  await fs.access(filePath);
  await fs.rm(filePath, { force: false });
}

export async function restoreCatalogBackup(fileName: string) {
  const filePath = getCatalogBackupFilePath(fileName);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  validateCatalogPayload(parsed);

  const profileNames = new Set(
    parsed.profiles
      .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
      .filter(Boolean)
  );

  for (const service of parsed.services) {
    if (service.profile && !profileNames.has(service.profile)) {
      throw new Error(`Р’ backup РЅР°Р№РґРµРЅ РїСЂРѕС„РёР»СЊ "${service.profile}", РєРѕС‚РѕСЂРѕРіРѕ РЅРµС‚ РІ СЃРїРёСЃРєРµ profiles.`);
    }
  }

  await createCatalogBackupInternal("pre_restore");
  await ensureDatabaseReady();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM services`);
    await client.query(`DELETE FROM profiles`);

    for (const profile of parsed.profiles) {
      await client.query(`INSERT INTO profiles (id, name) VALUES ($1, $2)`, [
        profile.id,
        profile.name,
      ]);
    }

    for (const service of parsed.services) {
      await client.query(
        `
          INSERT INTO services (id, code, name, med, profile)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [service.id, service.code, service.name, service.med, service.profile]
      );
    }

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('profiles', 'id'),
        COALESCE((SELECT MAX(id) FROM profiles), 1),
        COALESCE((SELECT MAX(id) FROM profiles), 0) > 0
      )
    `);
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('services', 'id'),
        COALESCE((SELECT MAX(id) FROM services), 1),
        COALESCE((SELECT MAX(id) FROM services), 0) > 0
      )
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readCatalogBackupFile(fileName: string) {
  const filePath = getCatalogBackupFilePath(fileName);
  const stat = await fs.stat(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return {
    stream,
    sizeBytes: stat.size,
    fileName,
  };
}

