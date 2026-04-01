import { dbQuery } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

export const TASK_STATUS_VALUES = [
  "new",
  "in_progress",
  "blocked",
  "review",
  "done",
  "canceled",
] as const;

export const TASK_PRIORITY_VALUES = ["low", "medium", "high"] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  new: ["in_progress", "canceled"],
  in_progress: ["review", "blocked", "canceled"],
  blocked: ["in_progress", "canceled"],
  review: ["done", "canceled", "in_progress"],
  done: [],
  canceled: [],
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUS_VALUES.includes(value as TaskStatus);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && TASK_PRIORITY_VALUES.includes(value as TaskPriority);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus) {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export type TaskGroupRow = {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type TaskMemberRow = {
  id: number;
  name: string;
  username: string;
  role: SessionUser["role"];
};

export type TaskRow = {
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
};

export async function getAccessibleTaskGroups(user: SessionUser): Promise<TaskGroupRow[]> {
  if (user.role === "god") {
    const groupsRes = await dbQuery<TaskGroupRow>(
      `
        SELECT id, name, description, is_active, created_by, created_at, updated_at
        FROM task_groups
        ORDER BY is_active DESC, name ASC, id ASC
      `
    );
    return groupsRes.rows;
  }

  const groupsRes = await dbQuery<TaskGroupRow>(
    `
      SELECT g.id, g.name, g.description, g.is_active, g.created_by, g.created_at, g.updated_at
      FROM task_groups g
      INNER JOIN task_group_members m ON m.group_id = g.id
      WHERE m.user_id = $1
        AND g.is_active = TRUE
      ORDER BY g.name ASC, g.id ASC
    `,
    [user.id]
  );
  return groupsRes.rows;
}

export async function userCanAccessTaskGroup(user: SessionUser, groupId: number) {
  if (user.role === "god") {
    const res = await dbQuery<{ id: number }>(
      `
        SELECT id
        FROM task_groups
        WHERE id = $1
        LIMIT 1
      `,
      [groupId]
    );
    return (res.rowCount || 0) > 0;
  }

  const res = await dbQuery<{ group_id: number }>(
    `
      SELECT m.group_id
      FROM task_group_members m
      INNER JOIN task_groups g ON g.id = m.group_id
      WHERE m.group_id = $1
        AND m.user_id = $2
        AND g.is_active = TRUE
      LIMIT 1
    `,
    [groupId, user.id]
  );
  return (res.rowCount || 0) > 0;
}

export async function isTaskGroupMember(groupId: number, userId: number) {
  const res = await dbQuery<{ user_id: number }>(
    `
      SELECT user_id
      FROM task_group_members
      WHERE group_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );
  return (res.rowCount || 0) > 0;
}

export async function getTaskGroupMembers(groupId: number): Promise<TaskMemberRow[]> {
  const membersRes = await dbQuery<TaskMemberRow>(
    `
      SELECT u.id, u.name, u.username, u.role
      FROM task_group_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1
      ORDER BY u.name ASC, u.username ASC, u.id ASC
    `,
    [groupId]
  );
  return membersRes.rows;
}

export async function getTaskById(taskId: number): Promise<TaskRow | null> {
  const taskRes = await dbQuery<TaskRow>(
    `
      SELECT
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
        completed_at
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return taskRes.rows[0] || null;
}

export async function appendTaskHistory(
  taskId: number,
  actorId: number | null,
  action: string,
  oldValue: Record<string, unknown> | null = null,
  newValue: Record<string, unknown> | null = null
) {
  await dbQuery(
    `
      INSERT INTO task_history(task_id, actor_id, action, old_value, new_value)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
    `,
    [
      taskId,
      actorId,
      action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
    ]
  );
}
