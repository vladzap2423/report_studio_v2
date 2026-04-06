import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  getTaskById,
  getTaskWithMetaById,
  isTaskGroupMember,
  isTaskPriority,
  isTaskStatus,
  userCanAccessTaskGroup,
  type TaskPriority,
  type TaskWithMetaRow,
} from "@/lib/tasks";
import { publishTaskEvent } from "@/lib/task-events";

type TaskListItem = TaskWithMetaRow;

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDueAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const groupId = parseNumber(url.searchParams.get("groupId"));
    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, groupId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this group" }, { status: 403 });
    }

    const search = String(url.searchParams.get("q") || "").trim();
    const statusRaw = url.searchParams.get("status");
    const priorityRaw = url.searchParams.get("priority");
    const mineOnly = url.searchParams.get("mine") === "1";
    const limitRaw = parseNumber(url.searchParams.get("limit"));
    const limit = Math.min(Math.max(limitRaw || 300, 1), 2000);

    const params: unknown[] = [groupId];
    const where: string[] = ["t.group_id = $1"];

    if (statusRaw && statusRaw !== "all") {
      if (!isTaskStatus(statusRaw)) {
        return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
      }
      params.push(statusRaw);
      where.push(`t.status = $${params.length}::task_status`);
    }

    if (priorityRaw && priorityRaw !== "all") {
      if (!isTaskPriority(priorityRaw)) {
        return NextResponse.json({ error: "Invalid priority filter" }, { status: 400 });
      }
      params.push(priorityRaw);
      where.push(`t.priority = $${params.length}::task_priority`);
    }

    if (mineOnly) {
      params.push(auth.user.id);
      where.push(`(t.assignee_id = $${params.length} OR t.creator_id = $${params.length})`);
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
    }

    params.push(limit);

    const tasksRes = await dbQuery<TaskListItem>(
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
          au.name AS assignee_name,
          t.comments_count
        FROM tasks t
        INNER JOIN users cu ON cu.id = t.creator_id
        LEFT JOIN users au ON au.id = t.assignee_id
        WHERE ${where.join(" AND ")}
        ORDER BY
          CASE t.priority
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            ELSE 3
          END,
          t.due_at ASC NULLS LAST,
          t.updated_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    return NextResponse.json({ tasks: tasksRes.rows });
  } catch (error) {
    console.error("Failed to load tasks:", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const groupId = parseNumber(body?.groupId);
    const title = String(body?.title || "").trim();
    const description = String(body?.description || "").trim();
    const assigneeIdRaw = parseNumber(body?.assigneeId);
    const priorityRaw = body?.priority;
    const dueAt = parseDueAt(body?.dueAt);

    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, groupId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this group" }, { status: 403 });
    }

    let assigneeId = assigneeIdRaw;
    if (!assigneeId) {
      const meInGroup = await isTaskGroupMember(groupId, auth.user.id);
      assigneeId = meInGroup ? auth.user.id : null;
    }

    if (assigneeId) {
      const member = await isTaskGroupMember(groupId, assigneeId);
      if (!member) {
        return NextResponse.json(
          { error: "Assignee must be a member of this group" },
          { status: 400 }
        );
      }
    }

    const priority: TaskPriority = isTaskPriority(priorityRaw) ? priorityRaw : "medium";

    if (body?.dueAt !== undefined && dueAt === undefined) {
      return NextResponse.json({ error: "Invalid dueAt value" }, { status: 400 });
    }

    const insertRes = await dbQuery<TaskListItem>(
      `
        INSERT INTO tasks(group_id, title, description, status, priority, creator_id, assignee_id, due_at)
        VALUES ($1, $2, $3, 'new', $4::task_priority, $5, $6, $7)
        RETURNING
          id,
          group_id,
          title,
          description,
          status,
          priority,
          creator_id,
          assignee_id,
          due_at,
          created_at,
          updated_at,
          started_at,
          completed_at,
          ''::text AS creator_name,
          NULL::text AS assignee_name
      `,
      [groupId, title, description, priority, auth.user.id, assigneeId, dueAt ?? null]
    );

    const task = insertRes.rows[0];
    await appendTaskHistory(
      task.id,
      auth.user.id,
      "create",
      null,
      {
        title: task.title,
        status: task.status,
        priority: task.priority,
        assignee_id: task.assignee_id,
        group_id: task.group_id,
      }
    );

    const taskWithMeta = await getTaskWithMetaById(task.id);
    if (taskWithMeta) {
      publishTaskEvent({
        type: "task_created",
        groupId: taskWithMeta.group_id,
        taskId: taskWithMeta.id,
        assigneeId: taskWithMeta.assignee_id,
        actorId: auth.user.id,
        occurredAt: taskWithMeta.updated_at || taskWithMeta.created_at,
        task: taskWithMeta,
      });
    }

    return NextResponse.json({ task: taskWithMeta }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = parseNumber(body?.id);
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = await getTaskById(id);
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, existing.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body || {}, "title")) {
      const title = String(body?.title || "").trim();
      if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      if (title !== existing.title) {
        oldValue.title = existing.title;
        newValue.title = title;
        values.push(title);
        updates.push(`title = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body || {}, "description")) {
      const description = String(body?.description || "").trim();
      if (description !== existing.description) {
        oldValue.description = existing.description;
        newValue.description = description;
        values.push(description);
        updates.push(`description = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body || {}, "priority")) {
      const priorityRaw = body?.priority;
      if (!isTaskPriority(priorityRaw)) {
        return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      }
      if (priorityRaw !== existing.priority) {
        oldValue.priority = existing.priority;
        newValue.priority = priorityRaw;
        values.push(priorityRaw);
        updates.push(`priority = $${values.length}::task_priority`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body || {}, "assigneeId")) {
      const assigneeId = parseNumber(body?.assigneeId);
      if (assigneeId) {
        const member = await isTaskGroupMember(existing.group_id, assigneeId);
        if (!member) {
          return NextResponse.json(
            { error: "Assignee must be a member of this group" },
            { status: 400 }
          );
        }
      }
      if ((assigneeId || null) !== existing.assignee_id) {
        oldValue.assignee_id = existing.assignee_id;
        newValue.assignee_id = assigneeId || null;
        values.push(assigneeId || null);
        updates.push(`assignee_id = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body || {}, "dueAt")) {
      const dueAt = parseDueAt(body?.dueAt);
      if (dueAt === undefined) {
        return NextResponse.json({ error: "Invalid dueAt value" }, { status: 400 });
      }
      if ((dueAt || null) !== (existing.due_at || null)) {
        oldValue.due_at = existing.due_at;
        newValue.due_at = dueAt || null;
        values.push(dueAt || null);
        updates.push(`due_at = $${values.length}`);
      }
    }

    if (updates.length === 0) {
      const taskWithMeta = await getTaskWithMetaById(id);
      return NextResponse.json({ task: taskWithMeta });
    }

    updates.push("updated_at = NOW()");
    values.push(id);

    const updateRes = await dbQuery<TaskListItem>(
      `
        UPDATE tasks
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          group_id,
          title,
          description,
          status,
          priority,
          creator_id,
          assignee_id,
          due_at,
          created_at,
          updated_at,
          started_at,
          completed_at,
          ''::text AS creator_name,
          NULL::text AS assignee_name
      `,
      values
    );

    const task = updateRes.rows[0];
    await appendTaskHistory(task.id, auth.user.id, "update", oldValue, newValue);

    const taskWithMeta = await getTaskWithMetaById(task.id);
    if (taskWithMeta) {
      publishTaskEvent({
        type: "task_updated",
        groupId: taskWithMeta.group_id,
        taskId: taskWithMeta.id,
        assigneeId: taskWithMeta.assignee_id,
        actorId: auth.user.id,
        occurredAt: taskWithMeta.updated_at || taskWithMeta.created_at,
        task: taskWithMeta,
      });
    }

    return NextResponse.json({ task: taskWithMeta });
  } catch (error) {
    console.error("Failed to update task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
