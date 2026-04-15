import { NextRequest, NextResponse } from "next/server";
import { dbQuery, ensureDatabaseReady } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import {
  buildSessionCookieOptions,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/session";
import type { UserRole } from "@/lib/roles";

type DbUser = {
  id: number;
  name: string;
  username: string;
  password: string;
  role: UserRole;
};

export async function POST(request: NextRequest) {
  await ensureDatabaseReady();

  let body: { username?: string; password?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const userRes = await dbQuery<DbUser>(
    `
      SELECT id, name, username, password, role
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const user = userRes.rows[0];
  if (!user) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 }
    );
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 }
    );
  }

  const token = await createSessionToken({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    },
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...buildSessionCookieOptions(request),
  });

  return response;
}
