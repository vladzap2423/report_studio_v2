import { NextResponse } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { spawn } from "child_process";

export const runtime = "nodejs"; // нужен node runtime, не edge

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

    p.on("error", (err) => reject(err));

    p.on("close", (code) => {
      if (code === 0) return resolve();
      const msg = (stderr || stdout || "").trim();
      reject(new Error(msg || `Process failed with code ${code}`));
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

function getPythonCmd() {
  // 1) Предпочитаем локальный venv
  const venvPythonWin = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  const venvPythonNix = path.join(process.cwd(), ".venv", "bin", "python");

  return { venvPythonWin, venvPythonNix };
}

export async function POST(req: Request) {
  const form = await req.formData();
  const scriptId = String(form.get("scriptId") || "");
  const file = form.get("files");

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required (FormData field 'files')" }, { status: 400 });
  }

  const scriptsRoot = path.join(process.cwd(), "scripts");
  const scriptDir = path.join(scriptsRoot, scriptId);
  const scriptPath = path.join(scriptDir, "report.py");

  if (!(await exists(scriptPath))) {
    return NextResponse.json(
      { error: `Script not found: ${scriptPath}` },
      { status: 404 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reports-"));
  const inputPath = path.join(tmpDir, file.name);
  const outputPath = path.join(tmpDir, `${scriptId}.xlsx`);

  try {
    // save upload
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    // выбираем python из venv
    const { venvPythonWin, venvPythonNix } = getPythonCmd();
    let pythonCmd = "";

    if (await exists(venvPythonWin)) pythonCmd = venvPythonWin;
    else if (await exists(venvPythonNix)) pythonCmd = venvPythonNix;
    else pythonCmd = "python"; // fallback (нежелательно, но пусть будет)

    // запускаем из папки плагина, чтобы medicaments.json находился рядом
    await runProcess(
      pythonCmd,
      [scriptPath, "--input", inputPath, "--output", outputPath],
      scriptDir
    );

    if (!(await exists(outputPath))) {
      return NextResponse.json(
        { error: "Report did not produce output file" },
        { status: 500 }
      );
    }

    const out = await fs.readFile(outputPath);

    return new NextResponse(out, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${scriptId}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "run failed" },
      { status: 500 }
    );
  } finally {
    // чистим временные файлы
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
