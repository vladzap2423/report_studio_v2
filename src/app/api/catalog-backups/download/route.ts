import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { readCatalogBackupFile } from "@/lib/catalog-backups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  const fileName = request.nextUrl.searchParams.get("fileName");
  if (!fileName) {
    return NextResponse.json({ error: "Не указан backup-файл." }, { status: 400 });
  }

  try {
    const file = await readCatalogBackupFile(fileName);
    return new NextResponse(file.stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось открыть backup-файл справочников.",
      },
      { status: 500 }
    );
  }
}
