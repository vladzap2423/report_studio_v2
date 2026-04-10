import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { requireApiRole } from "@/lib/require-api-role";

export const runtime = "nodejs";

type OutputFormat = "xlsx" | "zip";
type ResultKind = "single" | "multiple";

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function deriveReportId(title: string) {
  const transliterated = Array.from(String(title || "").trim().toLowerCase())
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("");

  const cleaned = transliterated
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return cleaned || `report_${Date.now()}`;
}

function normalizeResultKind(raw: string): ResultKind | null {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "single" || value === "multiple") return value;
  return null;
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
  const auth = await requireApiRole(req, "god");
  if (auth.response) return auth.response;

  const form = await req.formData();
  const title = String(form.get("title") || "").trim();
  const description = String(form.get("description") || "").trim();
  const resultKind = normalizeResultKind(String(form.get("resultKind") || "single"));
  const overwrite = String(form.get("overwrite") || "") === "1";
  const script = form.get("script");

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  if (!resultKind) {
    return NextResponse.json({ error: "invalid result kind" }, { status: 400 });
  }

  if (!(script instanceof File)) {
    return NextResponse.json({ error: "script is required" }, { status: 400 });
  }

  if (!script.name.toLowerCase().endsWith(".py")) {
    return NextResponse.json({ error: "script must be a .py file" }, { status: 400 });
  }

  const reportId = deriveReportId(title);
  const outputFormat: OutputFormat = resultKind === "multiple" ? "zip" : "xlsx";
  const reportsRoot = path.join(process.cwd(), "reports");
  const reportDir = path.join(reportsRoot, reportId);

  if (await exists(reportDir)) {
    if (!overwrite) {
      return NextResponse.json(
        { error: `report already exists: ${reportId}`, reportId },
        { status: 409 }
      );
    }
    await fs.rm(reportDir, { recursive: true, force: true });
  }

  await fs.mkdir(reportDir, { recursive: true });

  const manifest = {
    id: reportId,
    title,
    version: "1.0.0",
    description,
    outputs: {
      mode: resultKind,
      format: outputFormat,
    },
  };

  const scriptBuffer = Buffer.from(await script.arrayBuffer());
  await fs.writeFile(path.join(reportDir, "report.py"), scriptBuffer);
  await fs.writeFile(
    path.join(reportDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return NextResponse.json({ ok: true, reportId });
}
