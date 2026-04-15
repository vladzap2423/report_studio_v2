import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseReady, pool } from "@/lib/db";
import { preparePdfSignature } from "@/lib/pdf-signing";
import { requireApiRole } from "@/lib/require-api-role";
import { getTaskById, userCanAccessTaskGroup } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SigningPrepareContextRow = {
  task_id: number;
  group_id: number;
  status: string;
  original_name: string | null;
  file_path: string | null;
  signed_file_path: string | null;
  mime_type: string | null;
  signed_revision: number;
  route_id: number | null;
  step_id: number | null;
  step_order: number | null;
  signer_user_id: number | null;
  signer_name: string | null;
  placement_mode: "last_page" | "all_pages" | null;
  column_count: number | null;
  x_ratio: number | null;
  y_ratio: number | null;
  width_ratio: number | null;
  height_ratio: number | null;
  signer_count: number;
};

type PrepareCertificatePayload = {
  thumbprint?: unknown;
  subject?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
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

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  await ensureDatabaseReady();

  try {
    const body = await request.json();
    const taskId = parseNumber(body?.taskId);
    const certificatePayload = (body?.certificate ?? null) as PrepareCertificatePayload | null;
    const certificateThumbprint =
      typeof certificatePayload?.thumbprint === "string" ? certificatePayload.thumbprint.trim() : "";
    const certificateSubject =
      typeof certificatePayload?.subject === "string" ? certificatePayload.subject.trim() : "";
    const certificateValidFrom =
      typeof certificatePayload?.validFrom === "string" ? certificatePayload.validFrom.trim() : "";
    const certificateValidTo =
      typeof certificatePayload?.validTo === "string" ? certificatePayload.validTo.trim() : "";

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" }, { status: 404 });
    }

    if (task.kind !== "signing") {
      return NextResponse.json({ error: "Р­С‚Р° Р·Р°РґР°С‡Р° РЅРµ РѕС‚РЅРѕСЃРёС‚СЃСЏ Рє РїРѕРґРїРёСЃР°РЅРёСЋ" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕР№ Р·Р°РґР°С‡Рµ" }, { status: 403 });
    }

    const client = await pool.connect();
    let preparedPdfPath = "";

    try {
      await client.query("BEGIN");

      const contextRes = await client.query<SigningPrepareContextRow>(
        `
          SELECT
            t.id AS task_id,
            t.group_id,
            t.status,
            td.original_name,
            td.file_path,
            td.signed_file_path,
            td.mime_type,
            COALESCE(td.signed_revision, 0)::int AS signed_revision,
            tsr.id AS route_id,
            active_step.id AS step_id,
            active_step.step_order,
            active_step.signer_user_id,
            signer_user.name AS signer_name,
            tst.placement_mode,
            tst.column_count,
            tst.x_ratio,
            tst.y_ratio,
            tst.width_ratio,
            tst.height_ratio,
            COALESCE(step_counts.signer_count, 0)::int AS signer_count
          FROM tasks t
          LEFT JOIN task_documents td ON td.task_id = t.id
          LEFT JOIN task_signing_routes tsr ON tsr.task_id = t.id
          LEFT JOIN task_signing_steps active_step
            ON active_step.route_id = tsr.id
           AND active_step.state = 'active'
          LEFT JOIN users signer_user ON signer_user.id = active_step.signer_user_id
          LEFT JOIN task_signing_templates tst ON tst.task_id = t.id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS signer_count
            FROM task_signing_steps
            WHERE route_id = tsr.id
          ) step_counts ON TRUE
          WHERE t.id = $1
          FOR UPDATE OF t
        `,
        [taskId]
      );

      const context = contextRes.rows[0];
      if (!context || !context.route_id || !context.step_id) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "РђРєС‚РёРІРЅС‹Р№ РјР°СЂС€СЂСѓС‚ РїРѕРґРїРёСЃР°РЅРёСЏ РґР»СЏ Р·Р°РґР°С‡Рё РЅРµ РЅР°Р№РґРµРЅ" },
          { status: 400 }
        );
      }

      const sourcePath = context.signed_file_path || context.file_path;
      if (!sourcePath) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Р”РѕРєСѓРјРµРЅС‚ РґР»СЏ РїРѕРґРїРёСЃР°РЅРёСЏ РЅРµ РЅР°Р№РґРµРЅ" }, { status: 400 });
      }

      if (context.mime_type && !context.mime_type.toLowerCase().includes("pdf")) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "РЎРµР№С‡Р°СЃ РІСЃС‚СЂРѕРµРЅРЅР°СЏ РїРѕРґРїРёСЃСЊ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РґР»СЏ PDF-РґРѕРєСѓРјРµРЅС‚РѕРІ" },
          { status: 400 }
        );
      }

      if (!context.signer_user_id || !sameId(context.signer_user_id, auth.user.id)) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "РџРѕРґРїРёСЃР°С‚СЊ РґРѕРєСѓРјРµРЅС‚ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ С‚РµРєСѓС‰РёР№ Р°РєС‚РёРІРЅС‹Р№ РїРѕРґРїРёСЃР°РЅС‚" },
          { status: 403 }
        );
      }

      if (
        context.x_ratio == null ||
        context.y_ratio == null ||
        context.width_ratio == null ||
        context.height_ratio == null
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Р”Р»СЏ Р·Р°РґР°С‡Рё РЅРµ РЅР°СЃС‚СЂРѕРµРЅ С€Р°Р±Р»РѕРЅ СЂР°Р·РјРµС‰РµРЅРёСЏ С€С‚Р°РјРїРѕРІ" },
          { status: 400 }
        );
      }

      if (context.placement_mode === "all_pages") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Р РµР¶РёРј СЂР°Р·РјРµС‰РµРЅРёСЏ С€С‚Р°РјРїР° РЅР° РІСЃРµС… Р»РёСЃС‚Р°С… РїРѕРєР° РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ РґР»СЏ СЂРµР°Р»СЊРЅРѕР№ PDF-РїРѕРґРїРёСЃРё. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРѕСЃР»РµРґРЅРёР№ Р»РёСЃС‚." },
          { status: 400 }
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

      const sourceBuffer = await fs.readFile(sourcePath);
      const sourceSha256 = createHash("sha256").update(sourceBuffer).digest("hex");

      const sessionId = randomUUID();
      const workDir = path.join(process.cwd(), "storage", "task-documents", String(taskId), "prepared");
      preparedPdfPath = path.join(workDir, `${sessionId}.pdf`);
      const fieldName = `TaskSig_${taskId}_${context.step_order}`;
      const xRatio = context.x_ratio!;
      const yRatio = context.y_ratio!;
      const widthRatio = context.width_ratio!;
      const heightRatio = context.height_ratio!;
      const stepOrder = context.step_order!;
      const columnCount = context.column_count === 2 ? 2 : 1;

      const prepared = await preparePdfSignature({
        inputPath: sourcePath,
        preparedOutputPath: preparedPdfPath,
        workDir,
        fieldName,
        xRatio,
        yRatio,
        widthRatio,
        heightRatio,
        columnCount,
        stepOrder,
        stepTotal: Math.max(1, context.signer_count),
        signerName: context.signer_name || auth.user.name,
        certificateSubject,
        certificateThumbprint,
        certificateValidFrom,
        certificateValidTo,
      });

      await client.query(
        `
          INSERT INTO task_signing_sessions(
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
            expires_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            NOW() + INTERVAL '30 minutes'
          )
        `,
        [
          sessionId,
          taskId,
          context.route_id,
          context.step_id,
          auth.user.id,
          prepared.preparedPdfPath,
          prepared.documentDigest,
          prepared.reservedRegionStart,
          prepared.reservedRegionEnd,
          sourceSha256,
          fieldName,
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json({
        sessionId,
        bytesToSignBase64: prepared.bytesToSignBase64,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      if (preparedPdfPath) {
        await fs.rm(preparedPdfPath, { force: true }).catch(() => null);
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Failed to prepare task document for signing:", error);
    return NextResponse.json(
      { error: error?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРіРѕС‚РѕРІРёС‚СЊ РґРѕРєСѓРјРµРЅС‚ Рє РїРѕРґРїРёСЃРё" },
      { status: 500 }
    );
  }
}

