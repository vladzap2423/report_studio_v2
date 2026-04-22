import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import {
  createDbBackup,
  deleteDbBackup,
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

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  const fileName = request.nextUrl.searchParams.get("fileName");
  if (!fileName) {
    return NextResponse.json({ error: "Не указан backup-файл для удаления." }, { status: 400 });
  }

  try {
    await deleteDbBackup(fileName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось удалить backup-файл." },
      { status: 500 }
    );
  }
}
