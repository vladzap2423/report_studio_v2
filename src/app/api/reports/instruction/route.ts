import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { requireApiRole } from "@/lib/require-api-role";

export const runtime = "nodejs";

const INSTRUCTION_FILES = ["instruction.txt"];

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const reportId = searchParams.get("reportId");

  if (!reportId) {
    return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
  }

  const safeId = path.basename(reportId);
  if (safeId !== reportId) {
    return NextResponse.json({ error: "Invalid reportId" }, { status: 400 });
  }

  const reportsRoot = path.join(process.cwd(), "reports");
  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(reportsRoot, reportId, filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return NextResponse.json({ content, filename });
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      return NextResponse.json({ error: "Failed to read instruction." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Instruction not found." }, { status: 404 });
}
