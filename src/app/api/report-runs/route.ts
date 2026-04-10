import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { createReportRun, ReportRunError } from "@/lib/report-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if ("response" in auth) return auth.response;

  try {
    const form = await request.formData();
    const reportId = String(form.get("reportId") || "");
    const first = form.getAll("files")[0];
    const file = first instanceof File ? first : form.get("files");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const run = await createReportRun({
      reportIdRaw: reportId,
      file,
      userId: auth.user.id,
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof ReportRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create report run" },
      { status: 500 }
    );
  }
}
