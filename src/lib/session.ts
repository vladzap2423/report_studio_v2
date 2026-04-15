import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { UserRole } from "@/lib/roles";

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "report_studio_session";

export type SessionUser = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
};

function getSessionTtlDays() {
  const parsed = Number(process.env.SESSION_EXPIRES_DAYS || "7");
  if (!Number.isFinite(parsed) || parsed <= 0) return 7;
  return Math.floor(parsed);
}

export function getSessionMaxAgeSeconds() {
  return getSessionTtlDays() * 24 * 60 * 60;
}

function isHttpsLikeRequest(request: Pick<NextRequest, "nextUrl" | "headers">) {
  if (request.nextUrl.protocol === "https:") return true;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (!forwardedProto) return false;

  return forwardedProto
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes("https");
}

export function buildSessionCookieOptions(
  request: Pick<NextRequest, "nextUrl" | "headers">
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttpsLikeRequest(request),
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  };
}

export function buildExpiredSessionCookieOptions(
  request: Pick<NextRequest, "nextUrl" | "headers">
) {
  return {
    ...buildSessionCookieOptions(request),
    expires: new Date(0),
    maxAge: 0,
  };
}

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser) {
  const ttlDays = getSessionTtlDays();
  return new SignJWT({
    name: user.name,
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${ttlDays}d`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });

    const id = Number(payload.sub);
    const name = typeof payload.name === "string" ? payload.name : "";
    const username =
      typeof payload.username === "string" ? payload.username : "";
    const role =
      payload.role === "user" || payload.role === "admin" || payload.role === "god"
        ? payload.role
        : null;

    if (!Number.isFinite(id) || !name || !username || !role) {
      return null;
    }

    return { id, name, username, role };
  } catch {
    return null;
  }
}
