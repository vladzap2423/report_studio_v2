import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasRequiredRole } from "@/lib/roles";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { getCurrentUserFromSessionToken } from "@/lib/current-user";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login?next=/admin");
  }

  const user = await getCurrentUserFromSessionToken(token);
  if (!user) {
    redirect("/login?next=/admin");
  }

  if (!hasRequiredRole(user.role, "admin")) {
    redirect("/?forbidden=1");
  }

  return <>{children}</>;
}
