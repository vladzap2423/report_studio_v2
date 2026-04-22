import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  canTransitionTaskStatus,
  getTaskById,
  getTaskWithMetaById,
  isTaskStatus,
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
    const nextStatus = body?.status;

    if (!taskId || !isTaskStatus(nextStatus)) {
      return NextResponse.json({ error: "taskId and valid status are required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTask(auth.user, task);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    if (task.status === nextStatus) {
      const taskWithMeta = await getTaskWithMetaById(taskId);
      return NextResponse.json({ task: taskWithMeta });
    }

    if (!canTransitionTaskStatus(task.status, nextStatus)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${task.status} -> ${nextStatus}` },
        { status: 400 }
      );
    }

    if (auth.user.role !== "god" && task.assignee_id !== auth.user.id) {
      return NextResponse.json(
        { error: "Only the assignee can change task status" },
        { status: 403 }
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

    if (task.status === "done" && nextStatus !== "done") {
      setClauses.push("completed_at = NULL");
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

    const taskWithMeta = await getTaskWithMetaById(taskId);
    if (taskWithMeta) {
      publishTaskEvent({
        type: "task_status_changed",
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
    console.error("Failed to update task status:", error);
    return NextResponse.json({ error: "Failed to update task status" }, { status: 500 });
  }
}
