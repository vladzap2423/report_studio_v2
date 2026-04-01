import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import {
  getTaskGroupMembers,
  userCanAccessTaskGroup,
  type TaskMemberRow,
} from "@/lib/tasks";

function parseRequiredNumber(value: string | null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isGod(role: string) {
  return role === "god";
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const groupId = parseRequiredNumber(url.searchParams.get("groupId"));
    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, groupId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this group" }, { status: 403 });
    }

    const members = await getTaskGroupMembers(groupId);
    return NextResponse.json({ members });
  } catch (error) {
    console.error("Failed to load task group members:", error);
    return NextResponse.json({ error: "Failed to load task group members" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  if (!isGod(auth.user.role)) {
    return NextResponse.json({ error: "Only god can modify group members" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const groupId = Number(body?.groupId);
    const userId = Number(body?.userId);
    if (!Number.isFinite(groupId) || !Number.isFinite(userId)) {
      return NextResponse.json({ error: "groupId and userId are required" }, { status: 400 });
    }

    const groupRes = await dbQuery<{ id: number }>(
      `
        SELECT id
        FROM task_groups
        WHERE id = $1
        LIMIT 1
      `,
      [groupId]
    );
    if ((groupRes.rowCount || 0) === 0) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const userRes = await dbQuery<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    if ((userRes.rowCount || 0) === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await dbQuery(
      `
        INSERT INTO task_group_members(group_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (group_id, user_id) DO NOTHING
      `,
      [groupId, userId]
    );

    const members = await getTaskGroupMembers(groupId);
    return NextResponse.json({ members });
  } catch (error) {
    console.error("Failed to add task group member:", error);
    return NextResponse.json({ error: "Failed to add task group member" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  if (!isGod(auth.user.role)) {
    return NextResponse.json({ error: "Only god can modify group members" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const groupId = parseRequiredNumber(url.searchParams.get("groupId"));
    const userId = parseRequiredNumber(url.searchParams.get("userId"));

    if (!groupId || !userId) {
      return NextResponse.json({ error: "groupId and userId are required" }, { status: 400 });
    }

    const delRes = await dbQuery(
      `
        DELETE FROM task_group_members
        WHERE group_id = $1 AND user_id = $2
      `,
      [groupId, userId]
    );

    const members = await getTaskGroupMembers(groupId);
    return NextResponse.json({
      success: (delRes.rowCount || 0) > 0,
      members: members as TaskMemberRow[],
    });
  } catch (error) {
    console.error("Failed to remove task group member:", error);
    return NextResponse.json({ error: "Failed to remove task group member" }, { status: 500 });
  }
}
