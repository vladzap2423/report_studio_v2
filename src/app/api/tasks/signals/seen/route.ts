import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { userCanAccessTaskGroup } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const groupId = parseNumber(body?.groupId);

    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, groupId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this group" }, { status: 403 });
    }

    await dbQuery(
      `
        UPDATE task_notifications
        SET
          is_seen = TRUE,
          seen_at = NOW()
        WHERE user_id = $1
          AND group_id = $2
          AND kind = 'transfer'
          AND is_seen = FALSE
      `,
      [auth.user.id, groupId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to mark task signals as seen:", error);
    return NextResponse.json({ error: "Failed to mark task signals as seen" }, { status: 500 });
  }
}
