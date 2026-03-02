import { NextResponse } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { spawn } from "child_process";

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
      reject(new Error(stderr || stdout || `Process failed: ${code}`));
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

function getPythonPath() {
  const win = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  const nix = path.join(process.cwd(), ".venv", "bin", "python");
  return { win, nix };
}

export async function POST(req: Request) {
  const form = await req.formData();
  const scriptId = String(form.get("scriptId") || "");
  const file = form.get("files");

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const scriptsRoot = path.join(process.cwd(), "scripts");
  const scriptDir = path.join(scriptsRoot, scriptId);

  const jsPath = path.join(scriptDir, "report.js");
  const pyPath = path.join(scriptDir, "report.py");

  const hasJS = await exists(jsPath);
  const hasPY = await exists(pyPath);

  if (!hasJS && !hasPY) {
    return NextResponse.json(
      { error: "No report.js or report.py found in plugin" },
      { status: 404 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reports-"));
  const inputPath = path.join(tmpDir, file.name);
  const outputPath = path.join(tmpDir, `${scriptId}.xlsx`);

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    if (hasJS) {
      // JS приоритет
      await runProcess("node", [
        jsPath,
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], scriptDir);
    } else if (hasPY) {
      const { win, nix } = getPythonPath();
      let pythonCmd = "python";

      if (await exists(win)) pythonCmd = win;
      else if (await exists(nix)) pythonCmd = nix;

      await runProcess(pythonCmd, [
        pyPath,
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], scriptDir);
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
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
