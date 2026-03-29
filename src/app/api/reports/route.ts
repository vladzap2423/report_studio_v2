import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

export async function GET() {
  const reportsRoot = path.join(process.cwd(), "reports");
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(reportsRoot, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return NextResponse.json({ reports: [] });
  }

  const reports = [];
  for (const id of entries) {
    const manifestPath = path.join(reportsRoot, id, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const m = JSON.parse(raw);
      reports.push({
        id,
        title: m.title,
        version: m.version,
        description: m.description,
      });
    } catch {
      reports.push({ id, title: id });
    }
  }

  return NextResponse.json({ reports });
}
