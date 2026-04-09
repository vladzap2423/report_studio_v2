import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { getAccessibleTaskGroups } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TaskQueueSignalRow = {
  group_id: number | string;
  unread_count: number;
};

function parseGroupIds(value: string | null) {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const accessibleGroups = await getAccessibleTaskGroups(auth.user);
    const accessibleGroupIds = accessibleGroups
      .map((group) => Number(group.id))
      .filter((groupId) => Number.isFinite(groupId) && groupId > 0);
    const requestedGroupIds = parseGroupIds(new URL(request.url).searchParams.get("groupIds"));

    const targetGroupIds =
      requestedGroupIds.length > 0
        ? requestedGroupIds.filter((groupId) => accessibleGroupIds.includes(groupId))
        : accessibleGroupIds;

    if (targetGroupIds.length === 0) {
      return NextResponse.json({ signals: [] });
    }

    const signalsRes = await dbQuery<TaskQueueSignalRow>(
      `
        SELECT
          n.group_id,
          COUNT(*)::int AS unread_count
        FROM task_notifications n
        WHERE n.user_id = $1
          AND n.group_id = ANY($2::bigint[])
          AND n.kind = 'transfer'
          AND n.is_seen = FALSE
        GROUP BY n.group_id
      `,
      [auth.user.id, targetGroupIds]
    );

    return NextResponse.json({
      signals: signalsRes.rows.map((row) => ({
        groupId: Number(row.group_id),
        unreadCount: row.unread_count,
      })),
    });
  } catch (error) {
    console.error("Failed to load task queue signals:", error);
    return NextResponse.json({ error: "Failed to load task queue signals" }, { status: 500 });
  }
}
