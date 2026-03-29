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
  const scriptId = searchParams.get("scriptId");

  if (!scriptId) {
    return NextResponse.json({ error: "Missing scriptId" }, { status: 400 });
  }

  const safeId = path.basename(scriptId);
  if (safeId !== scriptId) {
    return NextResponse.json({ error: "Invalid scriptId" }, { status: 400 });
  }

  const scriptsRoot = path.join(process.cwd(), "scripts");
  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(scriptsRoot, scriptId, filename);
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
