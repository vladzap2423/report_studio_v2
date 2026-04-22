import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  appendTaskHistory,
  getTaskById,
  getTaskWithMetaById,
  isTaskGroupMember,
  isTaskKind,
  isTaskPriority,
  isTaskStatus,
  userCanAccessTask,
  userCanAccessTaskGroup,
  type TaskKind,
  type TaskPriority,
  type TaskWithMetaRow,
} from "@/lib/tasks";
import { publishTaskEvent } from "@/lib/task-events";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TaskListItem = TaskWithMetaRow;
type SigningPlacementMode = "last_page";
type SigningStampTemplate = {
  placementMode: SigningPlacementMode;
  columnCount: 1 | 2;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

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

function sanitizeFileName(fileName: string) {
  const safe = path
    .basename(fileName || "document")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim();

  return safe || "document";
}

function parseJsonField(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isSigningPlacementMode(value: unknown): value is SigningPlacementMode {
  return value === "last_page";
}

function isFiniteRatio(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSigningColumnCount(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function isValidSigningStampTemplate(value: unknown): value is SigningStampTemplate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isSigningPlacementMode(candidate.placementMode) &&
    isSigningColumnCount(candidate.columnCount) &&
    isFiniteRatio(candidate.xRatio) &&
    isFiniteRatio(candidate.yRatio) &&
    isFiniteRatio(candidate.widthRatio) &&
    isFiniteRatio(candidate.heightRatio) &&
    (candidate.widthRatio as number) > 0 &&
    (candidate.heightRatio as number) > 0 &&
    (candidate.xRatio as number) + (candidate.widthRatio as number) <= 1 &&
    (candidate.yRatio as number) + (candidate.heightRatio as number) <= 1
  );
}

function normalizeSignerIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
}

function isPdfDocument(file: File) {
  const name = file.name.toLowerCase();
  const mime = (file.type || "").toLowerCase();
  return name.endsWith(".pdf") || mime === "application/pdf";
}

async function parseCreateTaskPayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const documentEntry = formData.get("document");

    return {
      groupId: parseNumber(formData.get("groupId")),
      title: String(formData.get("title") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      assigneeIdRaw: parseNumber(formData.get("assigneeId")),
      priorityRaw: formData.get("priority"),
      dueAtRaw: formData.get("dueAt"),
      kindRaw: formData.get("kind"),
      signerIdsRaw: parseJsonField(formData.get("signerIds")),
      stampTemplateRaw: parseJsonField(formData.get("stampTemplate")),
      documentFile:
        documentEntry instanceof File && documentEntry.size > 0 ? documentEntry : null,
    };
  }

  const body = await request.json();
  return {
    groupId: parseNumber(body?.groupId),
    title: String(body?.title || "").trim(),
    description: String(body?.description || "").trim(),
    assigneeIdRaw: parseNumber(body?.assigneeId),
    priorityRaw: body?.priority,
    dueAtRaw: body?.dueAt,
    kindRaw: body?.kind,
    signerIdsRaw: body?.signerIds,
    stampTemplateRaw: body?.stampTemplate,
    documentFile: null,
  };
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

    params.push(auth.user.id);
    const currentUserParam = params.length;
    where.push(`
      (
        t.kind <> 'signing'
        OR t.creator_id = $${currentUserParam}
        OR EXISTS (
          SELECT 1
          FROM task_signing_routes access_tsr
          INNER JOIN task_signing_steps access_tss ON access_tss.route_id = access_tsr.id
          WHERE access_tsr.task_id = t.id
            AND access_tss.signer_user_id = $${currentUserParam}
        )
      )
    `);

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
      where.push(`
        (
          t.assignee_id = $${params.length}
          OR t.creator_id = $${params.length}
          OR (
            t.kind = 'signing'
            AND EXISTS (
              SELECT 1
              FROM task_signing_routes mine_tsr
              INNER JOIN task_signing_steps mine_tss ON mine_tss.route_id = mine_tsr.id
              WHERE mine_tsr.task_id = t.id
                AND mine_tss.signer_user_id = $${params.length}
            )
          )
        )
      `);
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
    const payload = await parseCreateTaskPayload(request);
    const groupId = payload.groupId;
    const title = payload.title;
    const description = payload.description;
    const assigneeIdRaw = payload.assigneeIdRaw;
    const priorityRaw = payload.priorityRaw;
    const dueAt = parseDueAt(payload.dueAtRaw);
    const kind: TaskKind = isTaskKind(payload.kindRaw) ? payload.kindRaw : "task";
    const signerIds = kind === "signing" ? normalizeSignerIds(payload.signerIdsRaw) : [];
    const stampTemplate = isValidSigningStampTemplate(payload.stampTemplateRaw)
      ? payload.stampTemplateRaw
      : null;

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

    if (kind === "signing" && signerIds.length > 0) {
      assigneeId = signerIds[0];
    }

    if (assigneeId) {
      const member = await isTaskGroupMember(groupId, assigneeId);
      if (!member) {
        return NextResponse.json(
          { error: "Исполнитель должен состоять в выбранной группе" },
          { status: 400 }
        );
      }
    }

    const priority: TaskPriority = isTaskPriority(priorityRaw) ? priorityRaw : "medium";
    const initialStatus = kind === "signing" ? "in_progress" : "new";

    if (payload.dueAtRaw !== undefined && payload.dueAtRaw !== null && dueAt === undefined) {
      return NextResponse.json({ error: "Invalid dueAt value" }, { status: 400 });
    }

    if (kind === "signing" && !payload.documentFile) {
      return NextResponse.json(
        { error: "document is required for signing task" },
        { status: 400 }
      );
    }

    if (kind === "signing" && payload.documentFile && !isPdfDocument(payload.documentFile)) {
      return NextResponse.json({ error: "Для подписания доступен только PDF" }, { status: 400 });
    }

    if (kind === "signing" && signerIds.length === 0) {
      return NextResponse.json({ error: "Выберите хотя бы одного подписанта" }, { status: 400 });
    }

    if (kind === "signing" && !stampTemplate) {
      return NextResponse.json(
        { error: "Сначала разместите блок штампов на документе" },
        { status: 400 }
      );
    }

    if (kind === "signing") {
      for (const signerId of signerIds) {
        const member = await isTaskGroupMember(groupId, signerId);
        if (!member) {
          return NextResponse.json(
            { error: "Все подписанты должны состоять в выбранной группе" },
            { status: 400 }
          );
        }
      }
    }

    const insertRes = await dbQuery<TaskListItem>(
      `
        INSERT INTO tasks(
          group_id,
          kind,
          title,
          description,
          status,
          priority,
          creator_id,
          assignee_id,
          due_at,
          started_at
        )
        VALUES ($1, $2::task_kind, $3, $4, $5::task_status, $6::task_priority, $7, $8, $9, $10)
        RETURNING
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
          completed_at,
          ''::text AS creator_name,
          NULL::text AS assignee_name,
          0::int AS comments_count,
          NULL::text AS document_name,
          NULL::bigint AS document_size,
          NULL::text AS document_mime_type,
          0::int AS signer_count,
          0::int AS signed_count,
          NULL::text AS signing_placement_mode,
          NULL::bigint AS signing_current_signer_id,
          NULL::text AS signing_current_signer_name,
          NULL::int AS signing_current_step_order,
          ARRAY[]::bigint[] AS signing_participant_ids
      `,
      [
        groupId,
        kind,
        title,
        description,
        initialStatus,
        priority,
        auth.user.id,
        assigneeId,
        dueAt ?? null,
        initialStatus === "in_progress" ? new Date().toISOString() : null,
      ]
    );

    const task = insertRes.rows[0];

    if (payload.documentFile) {
      const safeOriginalName = sanitizeFileName(payload.documentFile.name);
      const documentDir = path.join(
        process.cwd(),
        "storage",
        "task-documents",
        String(task.id)
      );
      const storedName = `${randomUUID()}${path.extname(safeOriginalName)}`;
      const documentPath = path.join(documentDir, storedName);
      const fileBuffer = Buffer.from(await payload.documentFile.arrayBuffer());

      try {
        await fs.mkdir(documentDir, { recursive: true });
        await fs.writeFile(documentPath, fileBuffer);

        await dbQuery(
          `
            INSERT INTO task_documents(task_id, original_name, stored_name, file_path, mime_type, file_size)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            task.id,
            safeOriginalName,
            storedName,
            documentPath,
            payload.documentFile.type || null,
            payload.documentFile.size,
          ]
        );
      } catch (error) {
        await dbQuery(`DELETE FROM tasks WHERE id = $1`, [task.id]).catch(() => null);
        await fs.rm(documentDir, { recursive: true, force: true }).catch(() => null);
        throw error;
      }
    }

    if (kind === "signing") {
      try {
        const routeRes = await dbQuery<{ id: number }>(
          `
            INSERT INTO task_signing_routes(task_id, mode, state, current_step_order, created_by)
            VALUES ($1, 'ordered_users', 'in_progress', 1, $2)
            RETURNING id
          `,
          [task.id, auth.user.id]
        );

        for (let index = 0; index < signerIds.length; index += 1) {
          await dbQuery(
            `
              INSERT INTO task_signing_steps(
                route_id,
                step_order,
                step_kind,
                state,
                signer_user_id
              )
              VALUES ($1, $2, 'user', $3, $4)
            `,
            [routeRes.rows[0].id, index + 1, index === 0 ? "active" : "pending", signerIds[index]]
          );
        }

        await dbQuery(
          `
            INSERT INTO task_signing_templates(
              task_id,
              placement_mode,
              column_count,
              x_ratio,
              y_ratio,
              width_ratio,
              height_ratio
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            task.id,
            "last_page",
            stampTemplate?.columnCount ?? 1,
            stampTemplate?.xRatio ?? 0,
            stampTemplate?.yRatio ?? 0,
            stampTemplate?.widthRatio ?? 0,
            stampTemplate?.heightRatio ?? 0,
          ]
        );
      } catch (error) {
        await dbQuery(`DELETE FROM tasks WHERE id = $1`, [task.id]).catch(() => null);
        await fs
          .rm(path.join(process.cwd(), "storage", "task-documents", String(task.id)), {
            recursive: true,
            force: true,
          })
          .catch(() => null);
        throw error;
      }
    }

    await appendTaskHistory(
      task.id,
      auth.user.id,
      "create",
      null,
      {
        title: task.title,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        assignee_id: task.assignee_id,
        group_id: task.group_id,
        signer_ids: signerIds,
        signing_placement_mode: "last_page",
        signing_column_count: stampTemplate?.columnCount ?? null,
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

    const canAccess = await userCanAccessTask(auth.user, existing);
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
            { error: "Исполнитель должен состоять в выбранной группе" },
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
