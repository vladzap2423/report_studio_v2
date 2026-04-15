import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import {
  createDbBackup,
  getBackupStorageDir,
  getBackupToolsStatus,
  listDbBackups,
} from "@/lib/db-backups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  try {
    const [backups, tools] = await Promise.all([listDbBackups(), getBackupToolsStatus()]);

    return NextResponse.json({
      backups,
      tools,
      storageDir: getBackupStorageDir(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось получить список backup-файлов." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  try {
    const backup = await createDbBackup("manual");
    return NextResponse.json({ backup });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось создать backup базы данных." },
      { status: 500 }
    );
  }
}
