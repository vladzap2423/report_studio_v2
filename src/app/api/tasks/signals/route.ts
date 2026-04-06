import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { getAccessibleTaskGroups } from "@/lib/tasks";

type TaskQueueSignalRow = {
  group_id: number;
  latest_activity_at: string | null;
  queue_count: number;
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
    const accessibleGroupIds = accessibleGroups.map((group) => group.id);
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
          t.group_id,
          COUNT(*)::int AS queue_count,
          MAX(COALESCE(t.updated_at, t.created_at))::text AS latest_activity_at
        FROM tasks t
        WHERE t.assignee_id = $1
          AND t.group_id = ANY($2::int[])
          AND t.status = 'new'
        GROUP BY t.group_id
      `,
      [auth.user.id, targetGroupIds]
    );

    return NextResponse.json({
      signals: signalsRes.rows.map((row) => ({
        groupId: row.group_id,
        queueCount: row.queue_count,
        latestActivityAt: row.latest_activity_at,
      })),
    });
  } catch (error) {
    console.error("Failed to load task queue signals:", error);
    return NextResponse.json({ error: "Failed to load task queue signals" }, { status: 500 });
  }
}
