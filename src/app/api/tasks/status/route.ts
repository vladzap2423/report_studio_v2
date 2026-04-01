import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  canTransitionTaskStatus,
  getTaskById,
  isTaskStatus,
  userCanAccessTaskGroup,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";

type TaskWithNames = {
  id: number;
  group_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creator_id: number;
  assignee_id: number | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  creator_name: string;
  assignee_name: string | null;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const taskId = parseNumber(body?.taskId);
    const nextStatus = body?.status;

    if (!taskId || !isTaskStatus(nextStatus)) {
      return NextResponse.json({ error: "taskId and valid status are required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    if (task.status === nextStatus) {
      const withNamesRes = await dbQuery<TaskWithNames>(
        `
          SELECT
            t.id,
            t.group_id,
            t.title,
            t.description,
            t.status,
            t.priority,
            t.creator_id,
            t.assignee_id,
            t.due_at,
            t.created_at,
            t.updated_at,
            t.started_at,
            t.completed_at,
            cu.name AS creator_name,
            au.name AS assignee_name
          FROM tasks t
          INNER JOIN users cu ON cu.id = t.creator_id
          LEFT JOIN users au ON au.id = t.assignee_id
          WHERE t.id = $1
        `,
        [taskId]
      );
      return NextResponse.json({ task: withNamesRes.rows[0] });
    }

    if (!canTransitionTaskStatus(task.status, nextStatus)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${task.status} -> ${nextStatus}` },
        { status: 400 }
      );
    }

    const setClauses: string[] = ["status = $1::task_status", "updated_at = NOW()"];
    const values: unknown[] = [nextStatus];

    if (nextStatus === "in_progress" && !task.started_at) {
      setClauses.push("started_at = NOW()");
    }

    if (nextStatus === "done") {
      setClauses.push("completed_at = NOW()");
    }

    values.push(taskId);

    await dbQuery(
      `
        UPDATE tasks
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );

    await appendTaskHistory(
      taskId,
      auth.user.id,
      "status_change",
      { status: task.status },
      { status: nextStatus }
    );

    const withNamesRes = await dbQuery<TaskWithNames>(
      `
        SELECT
          t.id,
          t.group_id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.creator_id,
          t.assignee_id,
          t.due_at,
          t.created_at,
          t.updated_at,
          t.started_at,
          t.completed_at,
          cu.name AS creator_name,
          au.name AS assignee_name
        FROM tasks t
        INNER JOIN users cu ON cu.id = t.creator_id
        LEFT JOIN users au ON au.id = t.assignee_id
        WHERE t.id = $1
      `,
      [taskId]
    );

    return NextResponse.json({ task: withNamesRes.rows[0] });
  } catch (error) {
    console.error("Failed to update task status:", error);
    return NextResponse.json({ error: "Failed to update task status" }, { status: 500 });
  }
}
