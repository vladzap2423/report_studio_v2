import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";

function normalizeScriptId(raw: string) {
  const s = String(raw || "").trim();
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

function safeRelativePath(input: string) {
  const cleaned = input.replace(/^[\\/]+/, "");
  const normalized = path.normalize(cleaned);
  if (path.isAbsolute(normalized)) return null;
  if (normalized.split(path.sep).includes("..")) return null;
  return normalized;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const scriptIdRaw = String(form.get("scriptId") || "");
  const scriptId = normalizeScriptId(scriptIdRaw);
  const overwrite = String(form.get("overwrite") || "") === "1";

  if (password !== "Zx44tfW") {
    return NextResponse.json({ error: "invalid password" }, { status: 403 });
  }

  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f) => f instanceof File) as File[];
  if (!files.length) {
    return NextResponse.json({ error: "files are required" }, { status: 400 });
  }

  const scriptsRoot = path.join(process.cwd(), "scripts");
  const scriptDir = path.join(scriptsRoot, scriptId);

  if (await exists(scriptDir)) {
    if (!overwrite) {
      return NextResponse.json(
        { error: "script already exists" },
        { status: 409 }
      );
    }
    await fs.rm(scriptDir, { recursive: true, force: true });
  }

  await fs.mkdir(scriptDir, { recursive: true });

  for (const file of files) {
    const rel = safeRelativePath(file.name);
    if (!rel) {
      return NextResponse.json(
        { error: "invalid file path" },
        { status: 400 }
      );
    }
    const targetPath = path.join(scriptDir, rel);
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(scriptDir) + path.sep;
    if (!resolvedTarget.startsWith(resolvedRoot)) {
      return NextResponse.json(
        { error: "invalid file path" },
        { status: 400 }
      );
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, buf);
  }

  return NextResponse.json({ ok: true, scriptId });
}
