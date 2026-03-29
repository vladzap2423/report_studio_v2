import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

function runProcess(cmd: string, args: string[], cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
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

function normalizeScriptId(raw: string) {
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

async function readOutputFormat(scriptDir: string): Promise<"xlsx" | "zip"> {
  const manifestPath = path.join(scriptDir, "manifest.json");
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

export async function POST(req: NextRequest) {
  const form = await req.formData();

  const scriptIdRaw = String(form.get("scriptId") || "");
  const scriptId = normalizeScriptId(scriptIdRaw);
  const first = form.getAll("files")[0];
  const file = first instanceof File ? first : form.get("files");

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const scriptsRoot = path.join(process.cwd(), "scripts");
  const scriptDir = path.join(scriptsRoot, scriptId);
  const pyPath = path.join(scriptDir, "report.py");

  if (!(await exists(pyPath))) {
    return NextResponse.json(
      { error: `report.py not found in plugin: ${scriptId}` },
      { status: 404 }
    );
  }

  const outFormat = await readOutputFormat(scriptDir); // всегда "xlsx" | "zip"

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reports-"));
  const inputPath = path.join(tmpDir, "input" + path.extname(file.name || ".xlsx"));
  const outFileName = `${scriptId}.${outFormat}`;
  const outputPath = path.join(tmpDir, outFileName);

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    const { win, nix } = getPythonPath();
    let pythonCmd = "python";
    if (await exists(win)) pythonCmd = win;
    else if (await exists(nix)) pythonCmd = nix;

    await runProcess(
      pythonCmd,
      [pyPath, "--input", inputPath, "--output", outputPath],
      scriptDir
    );

    if (!(await exists(outputPath))) {
      return NextResponse.json(
        { error: `Plugin finished but output not found: ${outFileName}` },
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
