import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import {
  createCatalogBackup,
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
