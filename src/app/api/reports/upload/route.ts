import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { requireApiRole } from "@/lib/require-api-role";

export const runtime = "nodejs";

function normalizeReportId(raw: string) {
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

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(req, "admin");
  if (auth.response) return auth.response;

  const form = await req.formData();
  const reportIdRaw = String(form.get("reportId") || "");
  const reportId = normalizeReportId(reportIdRaw);
  const overwrite = String(form.get("overwrite") || "") === "1";

  if (!reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f) => f instanceof File) as File[];
  if (!files.length) {
    return NextResponse.json({ error: "files are required" }, { status: 400 });
  }

  const reportsRoot = path.join(process.cwd(), "reports");
  const reportDir = path.join(reportsRoot, reportId);

  if (await exists(reportDir)) {
    if (!overwrite) {
      return NextResponse.json({ error: "report already exists" }, { status: 409 });
    }
    await fs.rm(reportDir, { recursive: true, force: true });
  }

  await fs.mkdir(reportDir, { recursive: true });

  for (const file of files) {
    const rel = safeRelativePath(file.name);
    if (!rel) {
      return NextResponse.json({ error: "invalid file path" }, { status: 400 });
    }

    const targetPath = path.join(reportDir, rel);
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(reportDir) + path.sep;

    if (!resolvedTarget.startsWith(resolvedRoot)) {
      return NextResponse.json({ error: "invalid file path" }, { status: 400 });
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, buf);
  }

  return NextResponse.json({ ok: true, reportId });
}
