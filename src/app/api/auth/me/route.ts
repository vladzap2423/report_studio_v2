import { NextRequest, NextResponse } from "next/server";
import { buildExpiredSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { getCurrentUserFromSessionToken } from "@/lib/current-user";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const user = await getCurrentUserFromSessionToken(token);
    if (!user) {
      const response = NextResponse.json({ user: null }, { status: 401 });
      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: "",
        ...buildExpiredSessionCookieOptions(request),
      });
      return response;
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Failed to read current user:", error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
