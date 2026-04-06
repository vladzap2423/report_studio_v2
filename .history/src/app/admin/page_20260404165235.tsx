"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ServicesAdminPanel from "./components/ServicesAdminPanel";
import ProfilesAdminPanel from "./components/ProfilesAdminPanel";
import ReportUploadPanel from "./components/ReportUploadPanel";
import UsersAdminPanel from "./components/UsersAdminPanel";
import PasswordPadAdminPage from "./components/PasswordPadAdminPage";
import TaskGroupsAdminPanel from "./components/TaskGroupsAdminPanel";

type Section = "services" | "profiles" | "reports" | "users" | "arduino" | "tasks";

const sectionGroups: {
  title: string;
  description: string;
  items: { id: Section; label: string }[];
}[] = [
  {
    title: "Отчеты",
    description: "Справочники и загрузка отчетных данных",
    items: [
      { id: "services", label: "Справочник услуг" },
      { id: "profiles", label: "Профили" },
      { id: "reports", label: "Загрузка отчетов" },
    ],
  },
  {
    title: "Доступ",
    description: "Пользователи и права",
    items: [{ id: "users", label: "Пользователи" }],
  },
  {
    title: "Задачи",
    description: "Управление рабочими группами",
    items: [{ id: "tasks", label: "Группы задач" }],
  },
  {
    title: "Интеграции",
    description: "Подключенные устройства и панели",
    items: [{ id: "arduino", label: "Ардуино" }],
  },
];

function normalizeSection(input: string | null): Section {
  if (input === "profiles") return "profiles";
  if (input === "users") return "users";
  if (input === "tasks") return "tasks";
  if (input === "reports") return "reports";
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
      <aside className="h-full w-80 shrink-0 rounded-2xl border border-slate-200/80 bg-white/70 p-3 backdrop-blur-sm">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="text-sm font-semibold text-slate-800">Администрирование</div>
        </div>

        <nav className="space-y-3">
          {sectionGroups.map((group) => (
            <div
              key={group.title}
              className="rounded-2xl border border-slate-200/80 bg-white/75 p-2"
            >
              <div className="px-2 pb-2 pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {group.title}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{group.description}</div>
              </div>

              <div className="space-y-1">
                {group.items.map((item) => {
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
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <section className="h-full min-h-0 flex-1 rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-sm">
        {section === "services" && <ServicesAdminPanel />}
        {section === "profiles" && <ProfilesAdminPanel />}
        {section === "users" && <UsersAdminPanel />}
        {section === "tasks" && <TaskGroupsAdminPanel />}
        {section === "reports" && <ReportUploadPanel />}
        {section === "arduino" && <PasswordPadAdminPage />}
      </section>
    </main>
  );
}
