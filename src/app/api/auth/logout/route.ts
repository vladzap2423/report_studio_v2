import { NextRequest, NextResponse } from "next/server";
import { buildExpiredSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...buildExpiredSessionCookieOptions(request),
  });
  return response;
}
