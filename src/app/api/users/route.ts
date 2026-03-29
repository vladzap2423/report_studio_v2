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
  const auth = await requireApiRole(request, "admin");
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
  const auth = await requireApiRole(request, "admin");
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
  const auth = await requireApiRole(request, "admin");
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
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    const role = parseRole(body?.role);

    if (!Number.isFinite(id) || !role) {
      return NextResponse.json({ error: "id and role are required" }, { status: 400 });
    }

    if (id === auth.user.id) {
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

    if (!hasRequiredRole(auth.user.role, role)) {
      return NextResponse.json(
        { error: "You cannot assign role higher than yours" },
        { status: 403 }
      );
    }

    if (target.role === "god" && role !== "god") {
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

    await dbQuery(
      `
        UPDATE users
        SET role = $1::user_role
        WHERE id = $2
      `,
      [role, id]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }
}
