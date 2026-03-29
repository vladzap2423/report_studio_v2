import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { dbQuery, ensureDatabaseReady } from "@/lib/db";

export const runtime = "nodejs";

type ServiceLookupRow = {
  code: string | null;
  med: number;
  profile: string | null;
};

function runProcess(
  cmd: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv
) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("error", reject);

    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error((stderr || stdout || `Process failed: ${code}`).trim()));
    });
  });
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeReportId(raw: string) {
  // только безопасные символы в имени папки/файла
  const s = String(raw || "").trim();
  const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned;
}

function getPythonPath() {
  const win = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  const nix = path.join(process.cwd(), ".venv", "bin", "python");
  return { win, nix };
}

async function readOutputFormat(reportDir: string): Promise<"xlsx" | "zip"> {
  const manifestPath = path.join(reportDir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const m = JSON.parse(raw);
    const fmt = String(m?.outputs?.format || "xlsx").toLowerCase();
    return fmt === "zip" ? "zip" : "xlsx";
  } catch {
    return "xlsx";
  }
}

function contentTypeFor(fmt: "xlsx" | "zip") {
  return fmt === "zip"
    ? "application/zip"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

async function writeServicesLookup(outputPath: string) {
  await ensureDatabaseReady();

  const result = await dbQuery<ServiceLookupRow>(
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

export async function POST(req: NextRequest) {
  const form = await req.formData();

  const reportIdRaw = String(form.get("reportId") || "");
  const reportId = normalizeReportId(reportIdRaw);
  const first = form.getAll("files")[0];
  const file = first instanceof File ? first : form.get("files");

  if (!reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const reportsRoot = path.join(process.cwd(), "reports");
  const reportDir = path.join(reportsRoot, reportId);
  const pyPath = path.join(reportDir, "report.py");

  if (!(await exists(pyPath))) {
    return NextResponse.json(
      { error: `report.py not found in report: ${reportId}` },
      { status: 404 }
    );
  }

  const outFormat = await readOutputFormat(reportDir);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reports-"));
  const inputPath = path.join(tmpDir, "input" + path.extname(file.name || ".xlsx"));
  const outFileName = `${reportId}.${outFormat}`;
  const outputPath = path.join(tmpDir, outFileName);
  const servicesLookupPath = path.join(tmpDir, "services.lookup.json");

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);
    await writeServicesLookup(servicesLookupPath);

    const { win, nix } = getPythonPath();
    let pythonCmd = "python";
    if (await exists(win)) pythonCmd = win;
    else if (await exists(nix)) pythonCmd = nix;

    await runProcess(
      pythonCmd,
      [pyPath, "--input", inputPath, "--output", outputPath],
      reportDir,
      {
        ...process.env,
        REPORT_SERVICES_PATH: servicesLookupPath,
      }
    );

    if (!(await exists(outputPath))) {
      return NextResponse.json(
        { error: `Report finished but output not found: ${outFileName}` },
        { status: 500 }
      );
    }

    const out = await fs.readFile(outputPath);

    return new NextResponse(out, {
      headers: {
        "Content-Type": contentTypeFor(outFormat),
        "Content-Disposition": `attachment; filename="${outFileName}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "run failed" },
      { status: 500 }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
