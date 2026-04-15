import { NextRequest, NextResponse } from "next/server";
import { hasRequiredRole, type UserRole } from "@/lib/roles";
import {
  buildExpiredSessionCookieOptions,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "@/lib/session";
import { getCurrentUserFromSessionToken } from "@/lib/current-user";

type RequireApiRoleResult =
  | { user: SessionUser; response?: never }
  | { user?: never; response: NextResponse };

function clearSessionCookie(
  request: NextRequest,
  response: NextResponse
) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...buildExpiredSessionCookieOptions(request),
  });
}

export async function requireApiRole(
  request: NextRequest,
  requiredRole: UserRole = "user"
): Promise<RequireApiRoleResult> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let user: SessionUser | null = null;
  try {
    user = await getCurrentUserFromSessionToken(token);
  } catch (error) {
    console.error("Failed to verify API session:", error);
    return {
      response: NextResponse.json({ error: "Auth check failed" }, { status: 500 }),
    };
  }

  if (!user) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    clearSessionCookie(request, response);
    return { response };
  }

  if (!hasRequiredRole(user.role, requiredRole)) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { user };
}
