import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { getReportRunForUser } from "@/lib/report-runs";

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
  const run = await getReportRunForUser(id, auth.user.id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
