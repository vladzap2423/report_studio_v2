import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { getTaskById, userCanAccessTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TaskDocumentRow = {
  original_name: string;
  file_path: string;
  signed_file_path: string | null;
  mime_type: string | null;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildContentDisposition(fileName: string) {
  const fallback = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");

  return `attachment; filename="${fallback || "document"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function buildInlineContentDisposition(fileName: string) {
  const fallback = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");

  return `inline; filename="${fallback || "document"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const taskId = parseNumber(url.searchParams.get("taskId"));
    const inline = url.searchParams.get("inline") === "1";
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTask(auth.user, task);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const documentRes = await dbQuery<TaskDocumentRow>(
      `
        SELECT original_name, file_path, signed_file_path, mime_type
        FROM task_documents
        WHERE task_id = $1
        LIMIT 1
      `,
      [taskId]
    );

    const document = documentRes.rows[0];
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const effectivePath = document.signed_file_path || document.file_path;
    const fileBuffer = await fs.readFile(effectivePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": document.mime_type || "application/octet-stream",
        "Content-Disposition": inline
          ? buildInlineContentDisposition(document.original_name)
          : buildContentDisposition(document.original_name),
        "Cache-Control": "no-store",
        "X-Document-Name": encodeURIComponent(document.original_name),
      },
    });
  } catch (error) {
    console.error("Failed to download task document:", error);
    return NextResponse.json({ error: "Failed to download task document" }, { status: 500 });
  }
}
