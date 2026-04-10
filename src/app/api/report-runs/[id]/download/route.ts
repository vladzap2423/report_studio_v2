import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { getReportRunDownload, ReportRunError } from "@/lib/report-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireApiRole(request, "user");
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  try {
    const result = await getReportRunDownload(id, auth.user.id);
    return new NextResponse(result.body, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": result.contentDisposition,
      },
    });
  } catch (error) {
    if (error instanceof ReportRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to download result" },
      { status: 500 }
    );
  }
}
