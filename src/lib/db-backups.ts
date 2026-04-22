import "server-only";

import path from "path";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { createReadStream } from "fs";
import { Readable } from "stream";

type BackupKind = "manual" | "auto" | "pre_restore";

export type DbBackupInfo = {
  fileName: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: string;
};

type PgConnectionConfig = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

const BACKUP_DIR = path.join(process.cwd(), "storage", "db-backups");
const SAFE_BACKUP_FILE_RE = /^(manual|auto|pre_restore)__[0-9]{8}_[0-9]{6}__[a-z0-9_.-]+\.dump$/i;

declare global {
  // eslint-disable-next-line no-var
  var __rsDbBackupBusy: boolean | undefined;
}

function getPgConnectionConfig(): PgConnectionConfig {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    const database = url.pathname.replace(/^\//, "");

    if (!database || !url.username) {
      throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ РїР°СЂР°РјРµС‚СЂС‹ PostgreSQL РёР· DATABASE_URL.");
    }

    return {
      host: url.hostname || "localhost",
      port: url.port || "5432",
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password || ""),
      database: decodeURIComponent(database),
    };
  }

  const user = process.env.PG_USER;
  const password = process.env.PG_PASSWORD;
  const database = process.env.PG_DB;
  const host = process.env.PG_HOST || "localhost";
  const port = process.env.PG_PORT || "5432";

  if (!user || !password || !database) {
    throw new Error("DATABASE_URL РёР»Рё PG_USER/PG_PASSWORD/PG_DB РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ Р·Р°РґР°РЅС‹.");
  }

  return {
    host,
    port,
    user,
    password,
    database,
  };
}

function safeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function formatBackupTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") +
    "_" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

function getBackupToolPath(kind: "dump" | "restore") {
  if (kind === "dump") return process.env.PG_DUMP_PATH || "pg_dump";
  return process.env.PG_RESTORE_PATH || "pg_restore";
}

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

function buildProcessEnv(password: string) {
  return {
    ...process.env,
    ...(password ? { PGPASSWORD: password } : {}),
  };
}

function runProcess(command: string, args: string[], password: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: buildProcessEnv(password),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";
    let settled = false;

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            command.includes("pg_restore")
              ? "РЈС‚РёР»РёС‚Р° pg_restore РЅРµ РЅР°Р№РґРµРЅР°. Р”РѕР±Р°РІСЊС‚Рµ PostgreSQL bin РІ PATH РёР»Рё Р·Р°РґР°Р№С‚Рµ PG_RESTORE_PATH."
              : "РЈС‚РёР»РёС‚Р° pg_dump РЅРµ РЅР°Р№РґРµРЅР°. Р”РѕР±Р°РІСЊС‚Рµ PostgreSQL bin РІ PATH РёР»Рё Р·Р°РґР°Р№С‚Рµ PG_DUMP_PATH."
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;

      if (code === 0) {
        resolve();
        return;
      }

      const message = stderr.trim() || `РџСЂРѕС†РµСЃСЃ Р·Р°РІРµСЂС€РёР»СЃСЏ СЃ РєРѕРґРѕРј ${code ?? "unknown"}.`;
      reject(new Error(message));
    });
  });
}

function parseBackupKind(fileName: string): BackupKind {
  if (fileName.startsWith("pre_restore__")) return "pre_restore";
  if (fileName.startsWith("auto__")) return "auto";
  return "manual";
}

function getBackupFilePath(fileName: string) {
  if (!SAFE_BACKUP_FILE_RE.test(fileName)) {
    throw new Error("РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ РёРјСЏ backup-С„Р°Р№Р»Р°.");
  }
  return path.join(BACKUP_DIR, fileName);
}

export function getBackupStorageDir() {
  return BACKUP_DIR;
}

export async function getBackupToolsStatus() {
  const config = getPgConnectionConfig();

  const check = async (kind: "dump" | "restore") => {
    try {
      await runProcess(getBackupToolPath(kind), ["--version"], config.password);
      return true;
    } catch {
      return false;
    }
  };

  const [pgDump, pgRestore] = await Promise.all([check("dump"), check("restore")]);

  return {
    pgDump,
    pgRestore,
    database: config.database,
  };
}

export async function listDbBackups(): Promise<DbBackupInfo[]> {
  await ensureBackupDir();

  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && SAFE_BACKUP_FILE_RE.test(entry.name));

  const backups = (
    await Promise.all(
      files.map(async (entry) => {
        const stat = await fs.stat(path.join(BACKUP_DIR, entry.name));
        if (stat.size <= 0) return null;
        return {
          fileName: entry.name,
          kind: parseBackupKind(entry.name),
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        } satisfies DbBackupInfo;
      })
    )
  ).filter((item): item is DbBackupInfo => item !== null);

  backups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return backups;
}

async function createDbBackupInternal(kind: BackupKind) {
  await ensureBackupDir();
  const config = getPgConnectionConfig();
  const timestamp = formatBackupTimestamp(new Date());
  const databasePart = safeFilePart(config.database) || "database";
  const fileName = `${kind}__${timestamp}__${databasePart}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);

  try {
    await runProcess(
      getBackupToolPath("dump"),
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--host",
        config.host,
        "--port",
        config.port,
        "--username",
        config.user,
        "--dbname",
        config.database,
        "--file",
        filePath,
      ],
      config.password
    );
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }

  const stat = await fs.stat(filePath);

  return {
    fileName,
    kind,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  } satisfies DbBackupInfo;
}

export async function createDbBackup(kind: BackupKind = "manual") {
  if (global.__rsDbBackupBusy) {
    throw new Error("РћРїРµСЂР°С†РёСЏ backup/restore СѓР¶Рµ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ. Р”РѕР¶РґРёС‚РµСЃСЊ Р·Р°РІРµСЂС€РµРЅРёСЏ.");
  }

  global.__rsDbBackupBusy = true;
  try {
    return await createDbBackupInternal(kind);
  } finally {
    global.__rsDbBackupBusy = false;
  }
}

export async function deleteDbBackup(fileName: string) {
  if (global.__rsDbBackupBusy) {
    throw new Error("Операция backup/restore уже выполняется. Дождитесь завершения.");
  }

  const filePath = getBackupFilePath(fileName);
  await fs.access(filePath);
  await fs.rm(filePath, { force: false });
}

export async function restoreDbBackup(fileName: string) {
  if (global.__rsDbBackupBusy) {
    throw new Error("РћРїРµСЂР°С†РёСЏ backup/restore СѓР¶Рµ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ. Р”РѕР¶РґРёС‚РµСЃСЊ Р·Р°РІРµСЂС€РµРЅРёСЏ.");
  }

  global.__rsDbBackupBusy = true;

  try {
    const filePath = getBackupFilePath(fileName);
    await fs.access(filePath);

    const config = getPgConnectionConfig();

    await createDbBackupInternal("pre_restore");

    await runProcess(
      getBackupToolPath("restore"),
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--host",
        config.host,
        "--port",
        config.port,
        "--username",
        config.user,
        "--dbname",
        config.database,
        filePath,
      ],
      config.password
    );
  } finally {
    global.__rsDbBackupBusy = false;
  }
}

export async function readBackupFile(fileName: string) {
  const filePath = getBackupFilePath(fileName);
  const stat = await fs.stat(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return {
    stream,
    sizeBytes: stat.size,
    fileName,
  };
}

