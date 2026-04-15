import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { restoreCatalogBackup } from "@/lib/catalog-backups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestorePayload = {
  fileName?: string;
  confirmation?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if ("response" in auth) return auth.response;

  let payload: RestorePayload | null = null;
  try {
    payload = (await request.json()) as RestorePayload;
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса." }, { status: 400 });
  }

  const fileName = payload?.fileName?.trim();
  if (!fileName) {
    return NextResponse.json({ error: "Не указан backup-файл для восстановления." }, { status: 400 });
  }

  if (payload?.confirmation?.trim() !== fileName) {
    return NextResponse.json(
      { error: "Для восстановления введите точное имя backup-файла." },
      { status: 400 }
    );
  }

  try {
    await restoreCatalogBackup(fileName);
    return NextResponse.json({
      ok: true,
      message:
        "Справочники services и profiles восстановлены. Перед restore создан дополнительный JSON-backup.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось восстановить справочники services/profiles.",
      },
      { status: 500 }
    );
  }
}
