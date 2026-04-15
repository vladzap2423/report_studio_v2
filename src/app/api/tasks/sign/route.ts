import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseReady, pool } from "@/lib/db";
import { applyPdfSignature } from "@/lib/pdf-signing";
import { requireApiRole } from "@/lib/require-api-role";
import { appendTaskHistory, getTaskById, getTaskWithMetaById, userCanAccessTaskGroup } from "@/lib/tasks";
import { publishTaskEvent } from "@/lib/task-events";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SigningContextRow = {
  task_id: number;
  group_id: number;
  kind: string;
  status: string;
  file_path: string | null;
  signed_file_path: string | null;
  mime_type: string | null;
  signed_revision: number;
  route_id: number | null;
  route_state: string | null;
  step_id: number | null;
  step_order: number | null;
  signer_user_id: number | null;
  next_step_id: number | null;
  next_step_order: number | null;
  next_signer_user_id: number | null;
  next_signer_name: string | null;
};

type SigningSessionRow = {
  id: string;
  task_id: number;
  route_id: number;
  step_id: number;
  signer_user_id: number;
  prepared_pdf_path: string;
  document_digest: string;
  reserved_region_start: number;
  reserved_region_end: number;
  source_sha256: string;
  field_name: string;
  expires_at: string;
  used_at: string | null;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sameId(left: unknown, right: unknown) {
  const leftNum = Number(left);
  const rightNum = Number(right);
  return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum === rightNum;
}

function normalizeIsoDate(value: unknown) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSignatureBase64(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").trim();
}

function decodeBase64(value: string) {
  try {
    const buffer = Buffer.from(value, "base64");
    if (!buffer.length) return null;
    const normalizedInput = value.replace(/=+$/g, "");
    const normalizedOutput = buffer.toString("base64").replace(/=+$/g, "");
    return normalizedInput === normalizedOutput ? buffer : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  await ensureDatabaseReady();

  let signaturePath = "";
  let signedPdfPath = "";
  let preparedPdfPath = "";
  let committed = false;

  try {
    const body = await request.json();
    const taskId = parseNumber(body?.taskId);
    const sessionId = String(body?.sessionId || "").trim();
    const signatureBase64 = normalizeSignatureBase64(body?.signature);
    const certificateThumbprint = String(body?.certificate?.thumbprint || "").trim();
    const certificateSubject = String(body?.certificate?.subject || "").trim();
    const certificateIssuer = String(body?.certificate?.issuer || "").trim();
    const certificateSerial = String(body?.certificate?.serialNumber || "").trim();
    const certificateValidFrom = normalizeIsoDate(body?.certificate?.validFrom);
    const certificateValidTo = normalizeIsoDate(body?.certificate?.validTo);

    if (!taskId || !sessionId || !signatureBase64 || !certificateThumbprint || !certificateSubject) {
      return NextResponse.json(
        { error: "taskId, sessionId, signature и данные сертификата обязательны" },
        { status: 400 }
      );
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    }

    if (task.kind !== "signing") {
      return NextResponse.json({ error: "Эта задача не относится к подписанию" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Нет доступа к этой задаче" }, { status: 403 });
    }

    const signatureBuffer = decodeBase64(signatureBase64);
    if (!signatureBuffer) {
      return NextResponse.json({ error: "Не удалось распознать CMS-подпись" }, { status: 400 });
    }

    const client = await pool.connect();
    let signedStepOrder: number | null = null;
    let completed = false;
    let nextSignerName: string | null = null;

    try {
      await client.query("BEGIN");

      const contextRes = await client.query<SigningContextRow>(
        `
          SELECT
            t.id AS task_id,
            t.group_id,
            t.kind,
            t.status,
            td.file_path,
            td.signed_file_path,
            td.mime_type,
            COALESCE(td.signed_revision, 0)::int AS signed_revision,
            tsr.id AS route_id,
            tsr.state AS route_state,
            active_step.id AS step_id,
            active_step.step_order,
            active_step.signer_user_id,
            next_step.id AS next_step_id,
            next_step.step_order AS next_step_order,
            next_step.signer_user_id AS next_signer_user_id,
            next_user.name AS next_signer_name
          FROM tasks t
          LEFT JOIN task_documents td ON td.task_id = t.id
          LEFT JOIN task_signing_routes tsr ON tsr.task_id = t.id
          LEFT JOIN task_signing_steps active_step
            ON active_step.route_id = tsr.id
           AND active_step.state = 'active'
          LEFT JOIN LATERAL (
            SELECT id, step_order, signer_user_id
            FROM task_signing_steps
            WHERE route_id = tsr.id
              AND state = 'pending'
            ORDER BY step_order ASC
            LIMIT 1
          ) next_step ON TRUE
          LEFT JOIN users next_user ON next_user.id = next_step.signer_user_id
          WHERE t.id = $1
          FOR UPDATE OF t
        `,
        [taskId]
      );

      const context = contextRes.rows[0];
      if (!context || !context.route_id || !context.file_path) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Маршрут подписания для задачи не найден" }, { status: 400 });
      }

      if (context.mime_type && !context.mime_type.toLowerCase().includes("pdf")) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Встроенная подпись сейчас поддерживается только для PDF-документов" },
          { status: 400 }
        );
      }

      if (!context.step_id || !context.step_order || !context.signer_user_id) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: context.status === "done" ? "Документ уже подписан" : "Сейчас нет активного шага подписания" },
          { status: 400 }
        );
      }

      if (context.signer_user_id !== auth.user.id) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Подписать документ может только текущий активный подписант" },
          { status: 403 }
        );
      }

      await client.query(
        `
          SELECT id
          FROM task_signing_routes
          WHERE id = $1
          FOR UPDATE
        `,
        [context.route_id]
      );

      await client.query(
        `
          SELECT id
          FROM task_signing_steps
          WHERE id = $1
          FOR UPDATE
        `,
        [context.step_id]
      );

      const sessionRes = await client.query<SigningSessionRow>(
        `
          SELECT
            id,
            task_id,
            route_id,
            step_id,
            signer_user_id,
            prepared_pdf_path,
            document_digest,
            reserved_region_start,
            reserved_region_end,
            source_sha256,
            field_name,
            expires_at::text,
            used_at::text
          FROM task_signing_sessions
          WHERE id = $1
          FOR UPDATE
        `,
        [sessionId]
      );

      const session = sessionRes.rows[0];
      if (!session) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Сессия подписи не найдена" }, { status: 404 });
      }

      if (
        !sameId(session.task_id, taskId) ||
        !sameId(session.route_id, context.route_id) ||
        !sameId(session.step_id, context.step_id)
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Сессия подписи не соответствует текущему шагу" }, { status: 409 });
      }

      if (!sameId(session.signer_user_id, auth.user.id)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Сессия подписи принадлежит другому пользователю" }, { status: 403 });
      }

      if (session.used_at) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Эта сессия подписи уже использована" }, { status: 409 });
      }

      if (new Date(session.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Сессия подписи истекла. Подготовьте подпись заново" }, { status: 409 });
      }

      preparedPdfPath = session.prepared_pdf_path;

      const currentDocumentPath = context.signed_file_path || context.file_path;
      const currentDocumentBuffer = await fs.readFile(currentDocumentPath);
      const currentDocumentSha256 = createHash("sha256").update(currentDocumentBuffer).digest("hex");

      if (currentDocumentSha256 !== session.source_sha256) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Документ изменился после подготовки подписи. Подготовьте подпись заново" },
          { status: 409 }
        );
      }

      const signaturesDir = path.join(process.cwd(), "storage", "task-documents", String(taskId), "signatures");
      signaturePath = path.join(signaturesDir, `step-${context.step_order}-${randomUUID()}.p7s`);
      await fs.mkdir(signaturesDir, { recursive: true });
      await fs.writeFile(signaturePath, signatureBuffer);

      const signedDir = path.join(process.cwd(), "storage", "task-documents", String(taskId), "signed");
      signedPdfPath = path.join(signedDir, `signed-step-${context.step_order}-${randomUUID()}.pdf`);

      const { outputSize } = await applyPdfSignature({
        preparedInputPath: session.prepared_pdf_path,
        outputPath: signedPdfPath,
        documentDigest: session.document_digest,
        reservedRegionStart: session.reserved_region_start,
        reservedRegionEnd: session.reserved_region_end,
        signatureBase64,
      });

      const nextRevision = (context.signed_revision || 0) + 1;

      await client.query(
        `
          UPDATE task_documents
          SET
            signed_file_path = $2,
            signed_file_size = $3,
            signed_revision = $4,
            signed_updated_at = NOW()
          WHERE task_id = $1
        `,
        [taskId, signedPdfPath, outputSize, nextRevision]
      );

      await client.query(
        `
          INSERT INTO task_signatures(
            task_id,
            route_id,
            step_id,
            signer_user_id,
            signature_type,
            signature_format,
            signature_path,
            signature_size,
            document_sha256,
            certificate_thumbprint,
            certificate_subject,
            certificate_issuer,
            certificate_serial,
            certificate_valid_from,
            certificate_valid_to,
            signed_pdf_path,
            signed_pdf_size,
            signed_revision
          )
          VALUES (
            $1, $2, $3, $4,
            'pdf_cms_embedded',
            'p7s',
            $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16
          )
        `,
        [
          taskId,
          context.route_id,
          context.step_id,
          auth.user.id,
          signaturePath,
          signatureBuffer.length,
          currentDocumentSha256,
          certificateThumbprint,
          certificateSubject,
          certificateIssuer || null,
          certificateSerial || null,
          certificateValidFrom,
          certificateValidTo,
          signedPdfPath,
          outputSize,
          nextRevision,
        ]
      );

      await client.query(
        `
          UPDATE task_signing_sessions
          SET used_at = NOW()
          WHERE id = $1
        `,
        [sessionId]
      );

      await client.query(
        `
          UPDATE task_signing_steps
          SET
            state = 'signed',
            completed_by_user_id = $2,
            completed_at = NOW()
          WHERE id = $1
        `,
        [context.step_id, auth.user.id]
      );

      signedStepOrder = context.step_order;

      if (context.next_step_id && context.next_step_order && context.next_signer_user_id) {
        await client.query(
          `
            UPDATE task_signing_steps
            SET state = 'active'
            WHERE id = $1
          `,
          [context.next_step_id]
        );

        await client.query(
          `
            UPDATE task_signing_routes
            SET
              state = 'in_progress',
              current_step_order = $2,
              updated_at = NOW()
            WHERE id = $1
          `,
          [context.route_id, context.next_step_order]
        );

        await client.query(
          `
            UPDATE tasks
            SET
              assignee_id = $2,
              updated_at = NOW()
            WHERE id = $1
          `,
          [taskId, context.next_signer_user_id]
        );

        nextSignerName = context.next_signer_name;
      } else {
        await client.query(
          `
            UPDATE task_signing_routes
            SET
              state = 'completed',
              updated_at = NOW(),
              completed_at = NOW()
            WHERE id = $1
          `,
          [context.route_id]
        );

        await client.query(
          `
            UPDATE tasks
            SET
              status = 'done'::task_status,
              assignee_id = NULL,
              updated_at = NOW(),
              completed_at = NOW()
            WHERE id = $1
          `,
          [taskId]
        );

        completed = true;
      }

      await client.query("COMMIT");
      committed = true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }

    await fs.rm(preparedPdfPath, { force: true }).catch(() => null);

    await appendTaskHistory(taskId, auth.user.id, "signing_step_signed", null, {
      step_order: signedStepOrder,
      certificate_thumbprint: certificateThumbprint,
      certificate_subject: certificateSubject,
      completed,
      signed_pdf_path: signedPdfPath,
    });

    if (completed) {
      await appendTaskHistory(taskId, auth.user.id, "signing_completed", null, {
        status: "done",
      });
    }

    const taskWithMeta = await getTaskWithMetaById(taskId);
    if (taskWithMeta) {
      publishTaskEvent({
        type: "task_updated",
        groupId: taskWithMeta.group_id,
        taskId: taskWithMeta.id,
        assigneeId: taskWithMeta.assignee_id,
        actorId: auth.user.id,
        occurredAt: taskWithMeta.updated_at || new Date().toISOString(),
        task: taskWithMeta,
      });
    }

    return NextResponse.json({
      task: taskWithMeta,
      completed,
      nextSignerName,
      signedStepOrder,
    });
  } catch (error: any) {
    if (!committed) {
      if (signaturePath) {
        await fs.rm(signaturePath, { force: true }).catch(() => null);
      }
      if (signedPdfPath) {
        await fs.rm(signedPdfPath, { force: true }).catch(() => null);
      }
    }

    console.error("Failed to sign task document:", error);
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Этот шаг уже подписан" }, { status: 409 });
    }
    return NextResponse.json(
      { error: error?.message || "Не удалось встроить подпись в PDF" },
      { status: 500 }
    );
  }
}
