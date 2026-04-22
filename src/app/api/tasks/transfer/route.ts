import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  getTaskById,
  getTaskWithMetaById,
  isTaskGroupMember,
  userCanAccessTask,
} from "@/lib/tasks";
import { publishTaskEvent } from "@/lib/task-events";

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

    const canAccess = await userCanAccessTask(auth.user, task);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    if (auth.user.role !== "god" && task.assignee_id !== auth.user.id) {
      return NextResponse.json(
        { error: "Only the assignee can transfer this task" },
        { status: 403 }
      );
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
        SET
          assignee_id = $1,
          status = 'new',
          started_at = NULL,
          completed_at = NULL,
          updated_at = NOW()
        WHERE id = $2
      `,
      [assigneeId, taskId]
    );

    await dbQuery(
      `
        INSERT INTO task_comments(task_id, author_id, kind, body)
        VALUES ($1, $2, 'transfer', $3)
      `,
      [taskId, auth.user.id, comment]
    );

    await dbQuery(
      `
        UPDATE tasks
        SET comments_count = comments_count + 1
        WHERE id = $1
      `,
      [taskId]
    );

    await appendTaskHistory(
      taskId,
      auth.user.id,
      "transfer",
      { assignee_id: task.assignee_id, status: task.status },
      { assignee_id: assigneeId, status: "new", comment }
    );

    await dbQuery(
      `
        INSERT INTO task_notifications(user_id, task_id, group_id, kind, actor_id)
        VALUES ($1, $2, $3, 'transfer', $4)
      `,
      [assigneeId, taskId, task.group_id, auth.user.id]
    );

    const taskWithMeta = await getTaskWithMetaById(taskId);
    if (taskWithMeta) {
      publishTaskEvent({
        type: "task_transferred",
        groupId: taskWithMeta.group_id,
        taskId: taskWithMeta.id,
        assigneeId: taskWithMeta.assignee_id,
        actorId: auth.user.id,
        occurredAt: taskWithMeta.updated_at || new Date().toISOString(),
        task: taskWithMeta,
      });
    }

    return NextResponse.json({ task: taskWithMeta });
  } catch (error) {
    console.error("Failed to transfer task:", error);
    return NextResponse.json({ error: "Failed to transfer task" }, { status: 500 });
  }
}
