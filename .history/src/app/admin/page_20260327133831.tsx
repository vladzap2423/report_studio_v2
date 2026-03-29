"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ServicesAdminPanel from "./components/ServicesAdminPanel";
import ProfilesAdminPanel from "./components/ProfilesAdminPanel";
import ScriptUploadPanel from "./components/ScriptUploadPanel";
import UsersAdminPanel from "./components/UsersAdminPanel";
import PasswordPadAdminPage from "./components/PasswordPadAdminPage";

type Section = "services" | "profiles" | "scripts" | "users" | "arduino";

const sections: { id: Section; label: string }[] = [
  { id: "services", label: "Справочник услуг" },
  { id: "profiles", label: "Профили" },
  { id: "users", label: "Пользователи" },
  { id: "scripts", label: "Загрузка скриптов" },
  { id: "arduino", label: "Ардуино" }
];

function normalizeSection(input: string | null): Section {
  if (input === "profiles") return "profiles";
  if (input === "users") return "users";
  if (input === "scripts") return "scripts";
  if (input === "arduino") return "arduino";
  return "services";
}

export default function AdminPage() {
  const searchParams = useSearchParams();
  const section = useMemo(
    () => normalizeSection(searchParams.get("section")),
    [searchParams]
  );

  return (
    <main className="flex h-full w-full gap-4 py-3">
      <aside className="h-full w-64 shrink-0 rounded-2xl border border-slate-200/80 bg-white/40 p-3 backdrop-blur-sm">
        <div className="mb-3 px-3 py-2 text-sm font-semibold text-slate-700">Администрирование</div>
        <nav className="space-y-1">
          {sections.map((item) => {
            const active = item.id === section;
            return (
              <Link
                key={item.id}
                href={`/admin?section=${item.id}`}
                className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                  active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="h-full min-h-0 flex-1 rounded-2xl border border-slate-200/80 bg-white/40 backdrop-blur-sm">
        {section === "services" && <ServicesAdminPanel />}
        {section === "profiles" && <ProfilesAdminPanel />}
        {section === "users" && <UsersAdminPanel />}
        {section === "scripts" && <ScriptUploadPanel />}
        {section === "arduino" && <PasswordPadAdminPage />}
      </section>
    </main>
  );
}
