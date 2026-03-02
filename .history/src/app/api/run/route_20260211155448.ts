import { NextResponse } from "next/server";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { spawn } from "child_process";

export const runtime = "nodejs"; // важно: нужен node runtime, не edge

function runProcess(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `Process failed with code ${code}`));
    });
  });
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

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reports-"));
  const inputPath = path.join(tmpDir, file.name);
  const outputPath = path.join(tmpDir, `${scriptId}.xlsx`);

  const scriptsRoot = path.join(process.cwd(), "scripts");
  const scriptPath = path.join(scriptsRoot, scriptId, "report.py");

  // save upload
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(inputPath, buf);

  try {
    // IMPORTANT: python должен быть доступен как "python" (Windows может быть "py" или "python3")
    await runProcess("python", [scriptPath, "--input", inputPath, "--output", outputPath]);

    const out = await fs.readFile(outputPath);

    return new NextResponse(out, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${scriptId}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "run failed" }, { status: 500 });
  } finally {
    // можно почистить tmpDir позже; для MVP можно оставить, но лучше удалять
    // await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
