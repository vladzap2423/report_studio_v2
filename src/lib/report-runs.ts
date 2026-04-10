import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { dbQuery, ensureDatabaseReady } from "@/lib/db";

export type ReportRunStatus = "queued" | "running" | "done" | "failed" | "canceled";

type ReportMeta = {
  format: "xlsx" | "zip";
  title: string | null;
};

type ReportRunRow = {
  id: string;
  report_id: string;
  report_title: string | null;
  created_by: string;
  input_name: string;
  status: ReportRunStatus;
  output_name: string | null;
  output_path: string | null;
  error_text: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  canceled_at: Date | string | null;
};

export type ReportRunPublic = {
  id: string;
  reportId: string;
  reportTitle: string | null;
  createdBy: string;
  inputName: string;
  status: ReportRunStatus;
  outputName: string | null;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  canCancel: boolean;
  canDownload: boolean;
};

export class ReportRunError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ReportRunError";
    this.status = status;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __rsReportRunProcesses: Map<string, ChildProcess> | undefined;
}

const reportRunProcesses =
  global.__rsReportRunProcesses || new Map<string, ChildProcess>();

if (process.env.NODE_ENV !== "production") {
  global.__rsReportRunProcesses = reportRunProcesses;
}

const REPORT_RUNS_ROOT = path.join(process.cwd(), ".report-runs");

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeReportId(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeFileBaseName(raw: string, fallback: string) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function getPythonPath() {
  const win = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  const nix = path.join(process.cwd(), ".venv", "bin", "python");
  return { win, nix };
}

function contentTypeFor(format: "xlsx" | "zip") {
  return format === "zip"
    ? "application/zip"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function buildContentDisposition(fileName: string, fallback: string) {
  const asciiFallback = `${fallback.replace(/[^a-zA-Z0-9._-]/g, "_") || "report"}`;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function toIso(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapRow(row: ReportRunRow): ReportRunPublic {
  return {
    id: row.id,
    reportId: row.report_id,
    reportTitle: row.report_title,
    createdBy: row.created_by,
    inputName: row.input_name,
    status: row.status,
    outputName: row.output_name,
    errorText: row.error_text,
    createdAt: toIso(row.created_at) || new Date().toISOString(),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    canceledAt: toIso(row.canceled_at),
    canCancel: row.status === "queued" || row.status === "running",
    canDownload: row.status === "done" && Boolean(row.output_path),
  };
}

async function readReportMeta(reportDir: string): Promise<ReportMeta> {
  const manifestPath = path.join(reportDir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    const format = String(manifest?.outputs?.format || "xlsx").toLowerCase();
    return {
      format: format === "zip" ? "zip" : "xlsx",
      title: typeof manifest?.title === "string" ? manifest.title : null,
    };
  } catch {
    return { format: "xlsx", title: null };
  }
}

async function writeServicesLookup(outputPath: string) {
  await ensureDatabaseReady();

  const result = await dbQuery<{ code: string | null; med: number; profile: string | null }>(
    `
      SELECT code, med, profile
      FROM services
      WHERE code IS NOT NULL
        AND btrim(code) <> ''
    `
  );

  const services = result.rows.map((row) => ({
    code: String(row.code ?? "").trim(),
    med: Number(row.med ?? 0),
    profile: row.profile ? String(row.profile).trim() : "",
  }));

  await fs.writeFile(outputPath, JSON.stringify({ services }, null, 2), "utf8");
}

async function getPythonCommand() {
  const { win, nix } = getPythonPath();
  if (await exists(win)) return win;
  if (await exists(nix)) return nix;
  return "python";
}

async function fetchRunRow(runId: string) {
  const result = await dbQuery<ReportRunRow>(
    `
      SELECT
        id::text AS id,
        report_id,
        report_title,
        created_by::text AS created_by,
        input_name,
        status,
        output_name,
        output_path,
        error_text,
        created_at,
        started_at,
        finished_at,
        canceled_at
      FROM report_runs
      WHERE id = $1
      LIMIT 1
    `,
    [runId]
  );

  return result.rows[0] || null;
}

async function finalizeRun(runId: string, succeeded: boolean, message: string, outputPath: string) {
  reportRunProcesses.delete(runId);

  const current = await fetchRunRow(runId);
  if (!current) return;

  if (current.status === "canceled") {
    await dbQuery(
      `
        UPDATE report_runs
        SET finished_at = COALESCE(finished_at, NOW())
        WHERE id = $1
      `,
      [runId]
    );
    return;
  }

  const hasOutput = succeeded && (await exists(outputPath));
  await dbQuery(
    `
      UPDATE report_runs
      SET
        status = $2::report_run_status,
        error_text = $3,
        finished_at = NOW()
      WHERE id = $1
    `,
    [runId, hasOutput ? "done" : "failed", hasOutput ? null : message || "Output file was not created"]
  );
}

async function startRunProcess(args: {
  runId: string;
  reportDir: string;
  pyPath: string;
  inputPath: string;
  outputPath: string;
  servicesLookupPath: string;
}) {
  const pythonCmd = await getPythonCommand();
  const child = spawn(pythonCmd, [args.pyPath, "--input", args.inputPath, "--output", args.outputPath], {
    cwd: args.reportDir,
    env: {
      ...process.env,
      REPORT_SERVICES_PATH: args.servicesLookupPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  reportRunProcesses.set(args.runId, child);

  let stdout = "";
  let stderr = "";
  let finished = false;

  const finishOnce = (succeeded: boolean, message: string) => {
    if (finished) return;
    finished = true;
    void finalizeRun(args.runId, succeeded, message, args.outputPath);
  };

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    finishOnce(false, error.message || "Failed to start process");
  });

  child.on("close", (code, signal) => {
    if (signal) {
      finishOnce(false, `Process terminated: ${signal}`);
      return;
    }

    if (code === 0) {
      finishOnce(true, "");
      return;
    }

    finishOnce(false, (stderr || stdout || `Process failed: ${code}`).trim());
  });

  await dbQuery(
    `
      UPDATE report_runs
      SET
        status = 'running',
        started_at = NOW(),
        error_text = NULL
      WHERE id = $1
    `,
    [args.runId]
  );
}

export async function createReportRun(params: {
  reportIdRaw: string;
  file: File;
  userId: number;
}) {
  const reportId = normalizeReportId(params.reportIdRaw);
  if (!reportId) {
    throw new ReportRunError("reportId is required", 400);
  }

  if (!(params.file instanceof File)) {
    throw new ReportRunError("file is required", 400);
  }

  const reportDir = path.join(process.cwd(), "reports", reportId);
  const pyPath = path.join(reportDir, "report.py");

  if (!(await exists(pyPath))) {
    throw new ReportRunError(`report.py not found in report: ${reportId}`, 404);
  }

  const meta = await readReportMeta(reportDir);
  const outputFormat = meta.format;
  const outputName = `${sanitizeFileBaseName(meta.title || reportId, reportId)}.${outputFormat}`;

  const inserted = await dbQuery<ReportRunRow>(
    `
      INSERT INTO report_runs (report_id, report_title, created_by, input_name, status, output_name)
      VALUES ($1, $2, $3, $4, 'queued', $5)
      RETURNING
        id::text AS id,
        report_id,
        report_title,
        created_by::text AS created_by,
        input_name,
        status,
        output_name,
        output_path,
        error_text,
        created_at,
        started_at,
        finished_at,
        canceled_at
    `,
    [reportId, meta.title, params.userId, params.file.name || "input.xlsx", outputName]
  );

  const row = inserted.rows[0];
  const runId = row.id;
  const workDir = path.join(REPORT_RUNS_ROOT, runId);
  const inputExt = path.extname(params.file.name || ".xlsx") || ".xlsx";
  const inputPath = path.join(workDir, `input${inputExt}`);
  const outputPath = path.join(workDir, outputName);
  const servicesLookupPath = path.join(workDir, "services.lookup.json");

  try {
    await fs.mkdir(workDir, { recursive: true });
    const fileBuffer = Buffer.from(await params.file.arrayBuffer());
    await fs.writeFile(inputPath, fileBuffer);
    await writeServicesLookup(servicesLookupPath);

    await dbQuery(
      `
        UPDATE report_runs
        SET work_dir = $2, output_path = $3
        WHERE id = $1
      `,
      [runId, workDir, outputPath]
    );

    await startRunProcess({
      runId,
      reportDir,
      pyPath,
      inputPath,
      outputPath,
      servicesLookupPath,
    });

    const run = await getReportRunForUser(runId, params.userId);
    if (!run) {
      throw new ReportRunError("Run was created but could not be loaded", 500);
    }

    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start report run";
    await dbQuery(
      `
        UPDATE report_runs
        SET status = 'failed', error_text = $2, finished_at = NOW()
        WHERE id = $1
      `,
      [runId, message]
    ).catch(() => {});

    throw error;
  }
}

export async function getReportRunForUser(runId: string, userId: number) {
  const result = await dbQuery<ReportRunRow>(
    `
      SELECT
        id::text AS id,
        report_id,
        report_title,
        created_by::text AS created_by,
        input_name,
        status,
        output_name,
        output_path,
        error_text,
        created_at,
        started_at,
        finished_at,
        canceled_at
      FROM report_runs
      WHERE id = $1
        AND created_by = $2
      LIMIT 1
    `,
    [runId, userId]
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function cancelReportRun(runId: string, userId: number) {
  const run = await getReportRunForUser(runId, userId);
  if (!run) {
    throw new ReportRunError("Run not found", 404);
  }

  if (run.status === "done" || run.status === "failed" || run.status === "canceled") {
    return run;
  }

  const child = reportRunProcesses.get(runId);
  reportRunProcesses.delete(runId);

  await dbQuery(
    `
      UPDATE report_runs
      SET
        status = 'canceled',
        canceled_at = NOW(),
        finished_at = COALESCE(finished_at, NOW()),
        error_text = NULL
      WHERE id = $1
        AND created_by = $2
    `,
    [runId, userId]
  );

  if (child) {
    try {
      child.kill();
    } catch {
      // noop
    }
  }

  const nextRun = await getReportRunForUser(runId, userId);
  if (!nextRun) {
    throw new ReportRunError("Run not found", 404);
  }

  return nextRun;
}

export async function getReportRunDownload(runId: string, userId: number) {
  const result = await dbQuery<ReportRunRow & { output_path: string | null }>(
    `
      SELECT
        id::text AS id,
        report_id,
        report_title,
        created_by::text AS created_by,
        input_name,
        status,
        output_name,
        output_path,
        error_text,
        created_at,
        started_at,
        finished_at,
        canceled_at
      FROM report_runs
      WHERE id = $1
        AND created_by = $2
      LIMIT 1
    `,
    [runId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new ReportRunError("Run not found", 404);
  }

  if (row.status !== "done" || !row.output_path || !row.output_name) {
    throw new ReportRunError("Result is not ready", 409);
  }

  if (!(await exists(row.output_path))) {
    throw new ReportRunError("Result file not found", 404);
  }

  const format = row.output_name.toLowerCase().endsWith(".zip") ? "zip" : "xlsx";
  const fallback = `${row.report_id}.${format}`;
  const body = await fs.readFile(row.output_path);

  return {
    body,
    contentType: contentTypeFor(format),
    contentDisposition: buildContentDisposition(row.output_name, fallback),
  };
}
