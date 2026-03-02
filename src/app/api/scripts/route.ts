import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

export async function GET() {
  const scriptsRoot = path.join(process.cwd(), "scripts");
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(scriptsRoot, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return NextResponse.json({ scripts: [] });
  }

  const scripts = [];
  for (const id of entries) {
    const manifestPath = path.join(scriptsRoot, id, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const m = JSON.parse(raw);
      scripts.push({
        id,
        title: m.title,
        version: m.version,
        description: m.description,
      });
    } catch {
      scripts.push({ id, title: id });
    }
  }

  return NextResponse.json({ scripts });
}
