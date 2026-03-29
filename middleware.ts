import { NextRequest, NextResponse } from "next/server";
import { hasRequiredRole, type UserRole } from "@/lib/roles";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

function requiredRoleForPath(pathname: string): UserRole | null {
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/services") ||
    pathname.startsWith("/api/profiles") ||
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/scripts/upload")
  ) {
    return "admin";
  }

  return "user";
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/api/scripts" ||
    pathname === "/api/run" ||
    pathname.startsWith("/api/auth/login")
  );
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    if (pathname === "/login") {
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!token) return NextResponse.next();

      const user = await verifySessionToken(token);
      if (user) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/logout")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return redirectToLogin(request);
  }

  const user = await verifySessionToken(token);
  if (!user) {
    if (isApiPath(pathname)) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: "",
        path: "/",
        expires: new Date(0),
      });
      return res;
    }

    const res = redirectToLogin(request);
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      path: "/",
      expires: new Date(0),
    });
    return res;
  }

  const requiredRole = requiredRoleForPath(pathname);
  if (requiredRole && !hasRequiredRole(user.role, requiredRole)) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/?forbidden=1", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
