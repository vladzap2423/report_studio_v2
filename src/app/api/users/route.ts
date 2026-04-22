import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { hasRequiredRole, type UserRole } from "@/lib/roles";
import { requireApiRole } from "@/lib/require-api-role";

type DbUser = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  created_at: string;
};

function normalizeString(value: unknown): string | null {
  const str = String(value ?? "").trim();
  return str || null;
}

function parseRole(value: unknown): UserRole | null {
  if (value === "user" || value === "admin" || value === "god") return value;
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if (auth.response) return auth.response;

  try {
    const usersRes = await dbQuery<DbUser>(
      `
        SELECT id, name, username, role, created_at
        FROM users
        ORDER BY created_at DESC, id DESC
      `
    );

    return NextResponse.json({ users: usersRes.rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const name = normalizeString(body?.name);
    const username = normalizeString(body?.username);
    const password = normalizeString(body?.password);
    const role = parseRole(body?.role);

    if (!name || !username || !password || !role) {
      return NextResponse.json(
        { error: "name, username, password and role are required" },
        { status: 400 }
      );
    }

    if (!hasRequiredRole(auth.user.role, role)) {
      return NextResponse.json(
        { error: "You cannot create user with higher role than yours" },
        { status: 403 }
      );
    }

    const passwordHash = await hashPassword(password);

    await dbQuery(
      `
        INSERT INTO users(name, username, password, role)
        VALUES ($1, $2, $3, $4::user_role)
      `,
      [name, username, passwordHash, role]
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "User with this username already exists" },
        { status: 409 }
      );
    }

    console.error(error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if (auth.response) return auth.response;

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot delete yourself" },
        { status: 400 }
      );
    }

    const targetRes = await dbQuery<{ id: number; role: UserRole }>(
      `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const target = targetRes.rows[0];
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!hasRequiredRole(auth.user.role, target.role)) {
      return NextResponse.json(
        { error: "You cannot delete user with higher role than yours" },
        { status: 403 }
      );
    }

    if (target.role === "god") {
      const godsRes = await dbQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE role = 'god'`
      );
      const godsCount = Number(godsRes.rows[0]?.count || "0");
      if (godsCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last god user" },
          { status: 400 }
        );
      }
    }

    const delRes = await dbQuery(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [id]
    );

    return NextResponse.json({ success: (delRes.rowCount || 0) > 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiRole(request, "god");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    const hasRoleUpdate = Object.prototype.hasOwnProperty.call(body || {}, "role");
    const hasPasswordUpdate = Object.prototype.hasOwnProperty.call(body || {}, "password");
    const role = hasRoleUpdate ? parseRole(body?.role) : null;
    const password = hasPasswordUpdate ? normalizeString(body?.password) : null;

    if (!Number.isFinite(id) || (!hasRoleUpdate && !hasPasswordUpdate)) {
      return NextResponse.json({ error: "id and update field are required" }, { status: 400 });
    }

    if (hasRoleUpdate && !role) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (hasPasswordUpdate && !password) {
      return NextResponse.json({ error: "New password is required" }, { status: 400 });
    }

    if (hasRoleUpdate && id === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot change your own role" },
        { status: 400 }
      );
    }

    const targetRes = await dbQuery<{ id: number; role: UserRole }>(
      `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const target = targetRes.rows[0];
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!hasRequiredRole(auth.user.role, target.role)) {
      return NextResponse.json(
        { error: "You cannot change role of user with higher role than yours" },
        { status: 403 }
      );
    }

    if (hasRoleUpdate && role && !hasRequiredRole(auth.user.role, role)) {
      return NextResponse.json(
        { error: "You cannot assign role higher than yours" },
        { status: 403 }
      );
    }

    if (hasRoleUpdate && target.role === "god" && role !== "god") {
      const godsRes = await dbQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE role = 'god'`
      );
      const godsCount = Number(godsRes.rows[0]?.count || "0");
      if (godsCount <= 1) {
        return NextResponse.json(
          { error: "Cannot change role for the last god user" },
          { status: 400 }
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (hasRoleUpdate && role) {
      values.push(role);
      updates.push(`role = $${values.length}::user_role`);
    }

    if (hasPasswordUpdate && password) {
      const passwordHash = await hashPassword(password);
      values.push(passwordHash);
      updates.push(`password = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No changes to update" }, { status: 400 });
    }

    values.push(id);
    await dbQuery(
      `
        UPDATE users
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
