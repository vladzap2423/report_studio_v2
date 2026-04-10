import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { requireApiRole } from "@/lib/require-api-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResultKind = "single" | "multiple";

type ReportAdminItem = {
  id: string;
  title: string;
  version: string;
  description: string;
  resultKind: ResultKind;
};

type ReportManifest = {
  id?: unknown;
  title?: unknown;
  version?: unknown;
  description?: unknown;
  outputs?: {
    mode?: unknown;
    format?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function normalizeReportId(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function normalizeResultKind(raw: unknown): ResultKind | null {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "single" || value === "multiple") return value;
  return null;
}

function getResultKindFromManifest(manifest: ReportManifest): ResultKind {
  const mode = String(manifest.outputs?.mode || "").trim().toLowerCase();
  const format = String(manifest.outputs?.format || "").trim().toLowerCase();
  return mode === "multiple" || format === "zip" ? "multiple" : "single";
}

function toAdminItem(id: string, manifest: ReportManifest): ReportAdminItem {
  return {
    id,
    title: typeof manifest.title === "string" && manifest.title.trim() ? manifest.title : id,
    version:
      typeof manifest.version === "string" && manifest.version.trim()
        ? manifest.version
        : "1.0.0",
    description: typeof manifest.description === "string" ? manifest.description : "",
    resultKind: getResultKindFromManifest(manifest),
  };
}

async function readManifest(manifestPath: string): Promise<ReportManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as ReportManifest;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(req, "god");
  if (auth.response) return auth.response;

  const reportsRoot = path.join(process.cwd(), "reports");

  let dirents: Array<{ isDirectory(): boolean; name: string | Buffer }> = [];
  try {
    dirents = (await fs.readdir(reportsRoot, { withFileTypes: true })) as Array<{
      isDirectory(): boolean;
      name: string | Buffer;
    }>;
  } catch {
    return NextResponse.json({ reports: [] });
  }

  const reports = await Promise.all(
    dirents
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const reportId = String(entry.name);
        const manifestPath = path.join(reportsRoot, reportId, "manifest.json");
        try {
          const manifest = await readManifest(manifestPath);
          return toAdminItem(reportId, manifest);
        } catch {
          return {
            id: reportId,
            title: reportId,
            version: "1.0.0",
            description: "",
            resultKind: "single" as ResultKind,
          };
        }
      })
  );

  reports.sort((a, b) => a.title.localeCompare(b.title, "ru", { sensitivity: "base" }));

  return NextResponse.json({ reports });
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(req, "god");
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => null)) as
    | {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        resultKind?: unknown;
      }
    | null;

  const id = normalizeReportId(String(body?.id || ""));
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  const resultKind = normalizeResultKind(body?.resultKind);

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!resultKind) {
    return NextResponse.json({ error: "invalid result kind" }, { status: 400 });
  }

  const reportsRoot = path.join(process.cwd(), "reports");
  const reportDir = path.join(reportsRoot, id);
  const manifestPath = path.join(reportDir, "manifest.json");

  let current: ReportManifest;
  try {
    current = await readManifest(manifestPath);
  } catch {
    return NextResponse.json({ error: "manifest not found" }, { status: 404 });
  }

  const nextManifest: ReportManifest = {
    ...current,
    id,
    title,
    version:
      typeof current.version === "string" && current.version.trim()
        ? current.version
        : "1.0.0",
    description,
    outputs: {
      ...(current.outputs && typeof current.outputs === "object" ? current.outputs : {}),
      mode: resultKind,
      format: resultKind === "multiple" ? "zip" : "xlsx",
    },
  };

  await fs.writeFile(manifestPath, JSON.stringify(nextManifest, null, 2), "utf8");

  return NextResponse.json({
    ok: true,
    report: toAdminItem(id, nextManifest),
  });
}
