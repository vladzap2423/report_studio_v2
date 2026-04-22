"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasRequiredRole, type UserRole } from "@/lib/roles";

type HeaderLink = {
  label: string;
  href: string;
};

type HeaderProps = {
  title?: string;
  links?: HeaderLink[];
};

type CurrentUser = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
};

const Header: React.FC<HeaderProps> = ({ title = "ГП1 Платформа", links = [] }) => {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCurrentUser = async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: CurrentUser | null };
        if (!cancelled) {
          setUser(data.user || null);
        }
      } catch {
        // ignore
      }
    };

    if (pathname !== "/login") {
      loadCurrentUser();
    }

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const visibleLinks = useMemo(() => {
    return links.filter((link) => {
      if (link.href === "/admin") {
        return user ? hasRequiredRole(user.role, "admin") : false;
      }
      if (link.href === "/tasks") {
        return Boolean(user);
      }
      return true;
    });
  }, [links, user]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <header className="app-header app-frame w-full">
      <div className="flex w-full items-center justify-between rounded-3xl border border-gray-300 bg-white/50 px-4 py-3 shadow-sm">
        <div className="flex items-center space-x-6">
         
            <img
              src="/icon.png"
              alt=""
              className="h-15 w-15"
            />
            <div className="text-xl font-semibold text-black">{title}</div>
          

          <nav className="flex space-x-2">
            {visibleLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-3xl px-3 py-1.5 text-sm transition-colors ${
                    isActive ? "bg-slate-900 text-white" : "text-black hover:bg-gray-100"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {user ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              {user.name} ({user.role})
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              Выйти
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            Войти
          </Link>
        )}
      </div>
    </header>
  );
};

export default Header;
