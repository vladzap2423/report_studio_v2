import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import {
  createCatalogBackup,
  deleteCatalogBackup,
  getCatalogBackupStorageDir,
  listCatalogBackups,
} from "@/lib/catalog-backups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  try {
    const backups = await listCatalogBackups();
    return NextResponse.json({
      backups,
      storageDir: getCatalogBackupStorageDir(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось получить список backup-файлов справочников.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  try {
    const backup = await createCatalogBackup();
    return NextResponse.json({ backup });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось создать backup справочников services/profiles.",
      },
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
    await deleteCatalogBackup(fileName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось удалить backup-файл справочников.",
      },
      { status: 500 }
    );
  }
}
