import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  getTaskById,
  getTaskGroupMembers,
  isTaskGroupMember,
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
    const assigneeId = parseNumber(body?.assigneeId);
    const comment = String(body?.comment || "").trim();

    if (!taskId || !assigneeId || !comment) {
      return NextResponse.json(
        { error: "taskId, assigneeId and comment are required" },
        { status: 400 }
      );
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const member = await isTaskGroupMember(task.group_id, assigneeId);
    if (!member) {
      return NextResponse.json(
        { error: "Assignee must be a member of this group" },
        { status: 400 }
      );
    }

    if (task.assignee_id === assigneeId) {
      return NextResponse.json({ error: "Task already assigned to this user" }, { status: 400 });
    }

    await dbQuery(
      `
        UPDATE tasks
        SET assignee_id = $1, updated_at = NOW()
        WHERE id = $2
      `,
      [assigneeId, taskId]
    );

    const members = await getTaskGroupMembers(task.group_id);
    const fromMember = members.find((m) => m.id === task.assignee_id);
    const toMember = members.find((m) => m.id === assigneeId);

    const systemBody =
      `Передача задачи: ${fromMember?.name || "Не назначен"} -> ${toMember?.name || assigneeId}. ` +
      `Причина: ${comment}`;

    await dbQuery(
      `
        INSERT INTO task_comments(task_id, author_id, body)
        VALUES ($1, $2, $3)
      `,
      [taskId, auth.user.id, systemBody]
    );

    await appendTaskHistory(
      taskId,
      auth.user.id,
      "transfer",
      { assignee_id: task.assignee_id },
      { assignee_id: assigneeId, comment }
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
    console.error("Failed to transfer task:", error);
    return NextResponse.json({ error: "Failed to transfer task" }, { status: 500 });
  }
}
