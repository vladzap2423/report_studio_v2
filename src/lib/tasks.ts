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
export const TASK_KIND_VALUES = ["task", "signing"] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];
export type TaskKind = (typeof TASK_KIND_VALUES)[number];
export type SigningPlacementMode = "last_page";

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  new: ["in_progress", "canceled"],
  in_progress: ["done", "review", "blocked", "canceled"],
  blocked: ["in_progress", "done", "canceled"],
  review: ["done", "canceled", "in_progress"],
  done: ["in_progress"],
  canceled: [],
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUS_VALUES.includes(value as TaskStatus);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && TASK_PRIORITY_VALUES.includes(value as TaskPriority);
}

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && TASK_KIND_VALUES.includes(value as TaskKind);
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
  kind: TaskKind;
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

export type TaskWithMetaRow = TaskRow & {
  creator_name: string;
  assignee_name: string | null;
  comments_count: number;
  document_name: string | null;
  document_size: number | null;
  document_mime_type: string | null;
  signer_count: number;
  signed_count: number;
  signing_placement_mode: SigningPlacementMode | null;
  signing_current_signer_id: number | null;
  signing_current_signer_name: string | null;
  signing_current_step_order: number | null;
  signing_participant_ids: Array<number | string>;
};

export async function getAccessibleTaskGroups(user: SessionUser): Promise<TaskGroupRow[]> {
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

export async function userCanAccessTask(user: SessionUser, task: TaskRow) {
  const canAccessGroup = await userCanAccessTaskGroup(user, task.group_id);
  if (!canAccessGroup) return false;
  if (task.kind !== "signing") return true;
  if (Number(task.creator_id) === Number(user.id)) return true;

  const res = await dbQuery<{ id: number }>(
    `
      SELECT tss.id
      FROM task_signing_routes tsr
      INNER JOIN task_signing_steps tss ON tss.route_id = tsr.id
      WHERE tsr.task_id = $1
        AND tss.signer_user_id = $2
      LIMIT 1
    `,
    [task.id, user.id]
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
        kind,
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

export async function getTaskWithMetaById(taskId: number): Promise<TaskWithMetaRow | null> {
  const taskRes = await dbQuery<TaskWithMetaRow>(
    `
      SELECT
        t.id,
        t.group_id,
        t.kind,
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
        t.comments_count,
        td.original_name AS document_name,
        td.file_size AS document_size,
        td.mime_type AS document_mime_type,
        COALESCE(steps.signer_count, 0) AS signer_count,
        COALESCE(steps.signed_count, 0) AS signed_count,
        CASE WHEN t.kind = 'signing' THEN 'last_page' ELSE NULL END AS signing_placement_mode,
        current_step.signing_current_signer_id,
        current_step.signing_current_signer_name,
        current_step.signing_current_step_order,
        COALESCE(signing_participants.signing_participant_ids, ARRAY[]::bigint[]) AS signing_participant_ids
      FROM tasks t
      INNER JOIN users cu ON cu.id = t.creator_id
      LEFT JOIN users au ON au.id = t.assignee_id
      LEFT JOIN task_documents td ON td.task_id = t.id
      LEFT JOIN task_signing_routes tsr ON tsr.task_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS signer_count,
          COUNT(*) FILTER (WHERE tss.state = 'signed')::int AS signed_count
        FROM task_signing_steps tss
        WHERE tss.route_id = tsr.id
      ) steps ON TRUE
      LEFT JOIN task_signing_templates tst ON tst.task_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          tss.signer_user_id AS signing_current_signer_id,
          u.name AS signing_current_signer_name,
          tss.step_order AS signing_current_step_order
        FROM task_signing_steps tss
        LEFT JOIN users u ON u.id = tss.signer_user_id
        WHERE tss.route_id = tsr.id
          AND tss.state = 'active'
        ORDER BY tss.step_order ASC
        LIMIT 1
      ) current_step ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            array_agg(DISTINCT tss.signer_user_id) FILTER (WHERE tss.signer_user_id IS NOT NULL),
            ARRAY[]::bigint[]
          ) AS signing_participant_ids
        FROM task_signing_steps tss
        WHERE tss.route_id = tsr.id
      ) signing_participants ON TRUE
      WHERE t.id = $1
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
