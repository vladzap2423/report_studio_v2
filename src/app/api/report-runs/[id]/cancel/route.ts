import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { cancelReportRun, ReportRunError } from "@/lib/report-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireApiRole(request, "user");
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  try {
    const run = await cancelReportRun(id, auth.user.id);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ReportRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel run" },
      { status: 500 }
    );
  }
}
