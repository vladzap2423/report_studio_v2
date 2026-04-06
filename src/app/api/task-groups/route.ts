import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { getAccessibleTaskGroups, type TaskGroupRow } from "@/lib/tasks";

function canManageTaskGroups(role: string) {
  return role === "admin" || role === "god";
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const groups = await getAccessibleTaskGroups(auth.user);
    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Failed to load task groups:", error);
    return NextResponse.json({ error: "Failed to load task groups" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  if (!canManageTaskGroups(auth.user.role)) {
    return NextResponse.json({ error: "Only admin can create task groups" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const name = String(body?.name || "").trim();
    const description = String(body?.description || "").trim() || null;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const groupRes = await dbQuery<TaskGroupRow>(
      `
        INSERT INTO task_groups(name, description, created_by)
        VALUES ($1, $2, $3)
        RETURNING id, name, description, is_active, created_by, created_at, updated_at
      `,
      [name, description, auth.user.id]
    );

    const group = groupRes.rows[0];
    await dbQuery(
      `
        INSERT INTO task_group_members(group_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (group_id, user_id) DO NOTHING
      `,
      [group.id, auth.user.id]
    );

    return NextResponse.json({ group }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Group name must be unique" }, { status: 409 });
    }
    console.error("Failed to create task group:", error);
    return NextResponse.json({ error: "Failed to create task group" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  if (!canManageTaskGroups(auth.user.role)) {
    return NextResponse.json({ error: "Only admin can update task groups" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const id = Number(body?.id);
    const hasName = Object.prototype.hasOwnProperty.call(body || {}, "name");
    const hasDescription = Object.prototype.hasOwnProperty.call(body || {}, "description");
    const hasActive = Object.prototype.hasOwnProperty.call(body || {}, "isActive");

    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (hasName) {
      const name = String(body?.name || "").trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (hasDescription) {
      const description = String(body?.description || "").trim() || null;
      values.push(description);
      updates.push(`description = $${values.length}`);
    }

    if (hasActive) {
      values.push(Boolean(body?.isActive));
      updates.push(`is_active = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push("updated_at = NOW()");
    values.push(id);

    const updateRes = await dbQuery<TaskGroupRow>(
      `
        UPDATE task_groups
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
        RETURNING id, name, description, is_active, created_by, created_at, updated_at
      `,
      values
    );

    const group = updateRes.rows[0];
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json({ group });
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Group name must be unique" }, { status: 409 });
    }
    console.error("Failed to update task group:", error);
    return NextResponse.json({ error: "Failed to update task group" }, { status: 500 });
  }
}
