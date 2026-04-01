import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { getTaskById, userCanAccessTaskGroup } from "@/lib/tasks";

type TaskHistoryRow = {
  id: number;
  task_id: number;
  actor_id: number | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
  actor_username: string | null;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const taskId = parseNumber(url.searchParams.get("taskId"));
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const historyRes = await dbQuery<TaskHistoryRow>(
      `
        SELECT
          h.id,
          h.task_id,
          h.actor_id,
          h.action,
          h.old_value,
          h.new_value,
          h.created_at,
          u.name AS actor_name,
          u.username AS actor_username
        FROM task_history h
        LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.task_id = $1
        ORDER BY h.created_at DESC, h.id DESC
      `,
      [taskId]
    );

    return NextResponse.json({ history: historyRes.rows });
  } catch (error) {
    console.error("Failed to load task history:", error);
    return NextResponse.json({ error: "Failed to load task history" }, { status: 500 });
  }
}
