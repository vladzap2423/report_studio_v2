import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@/lib/roles";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { getCurrentUserFromSessionToken } from "@/lib/current-user";
import ServicesAdminPanel from "./components/ServicesAdminPanel";
import ProfilesAdminPanel from "./components/ProfilesAdminPanel";
import ReportsManifestAdminPanel from "./components/ReportsManifestAdminPanel";
import UsersAdminPanel from "./components/UsersAdminPanel";
import PasswordPadAdminPage from "./components/PasswordPadAdminPage";
import TaskGroupsAdminPanel from "./components/TaskGroupsAdminPanel";
import DatabaseBackupsAdminPanel from "./components/DatabaseBackupsAdminPanel";

type Section =
  | "services"
  | "profiles"
  | "reports"
  | "users"
  | "arduino"
  | "tasks"
  | "backups";

type AdminPageProps = {
  searchParams?: Promise<{ section?: string | string[] }>;
};

const sectionGroups: {
  title: string;
  description: string;
  items: { id: Section; label: string }[];
}[] = [
  {
    title: "Доступ",
    description: "Пользователи и права",
    items: [{ id: "users", label: "Пользователи" }],
  },
  {
    title: "Отчеты",
    description: "Справочники и управление отчетами",
    items: [
      { id: "services", label: "Справочник услуг" },
      { id: "profiles", label: "Профили" },
      { id: "reports", label: "Отчеты" },
    ],
  },
  {
    title: "Задачи",
    description: "Управление рабочими группами",
    items: [{ id: "tasks", label: "Группы" }],
  },
  {
    title: "ПРОЧЕЕ",
    description: "Другие...",
    items: [
      { id: "backups", label: "Резервные копии" },
      { id: "arduino", label: "Ардуино" },
    ],
  },
];

function normalizeSection(input: string | null | undefined): Section | null {
  if (input === "profiles") return "profiles";
  if (input === "users") return "users";
  if (input === "tasks") return "tasks";
  if (input === "reports") return "reports";
  if (input === "arduino") return "arduino";
  if (input === "services") return "services";
  if (input === "backups") return "backups";
  return null;
}

function getAllowedSections(role: UserRole): Section[] {
  if (role === "god") {
    return [
      "users",
      "services",
      "profiles",
      "reports",
      "tasks",
      "backups",
      "arduino",
    ];
  }
  if (role === "admin") {
    return ["services", "profiles"];
  }
  return [];
}

function getDefaultSection(role: UserRole): Section {
  return role === "god" ? "users" : "services";
}

function getVisibleSectionGroups(role: UserRole) {
  const allowed = new Set(getAllowedSections(role));
  return sectionGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => allowed.has(item.id)),
    }))
    .filter((group) => group.items.length > 0);
}

async function getAdminUserRole(): Promise<UserRole> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login?next=/admin");
  }

  const user = await getCurrentUserFromSessionToken(token);
  if (!user) {
    redirect("/login?next=/admin");
  }

  if (user.role !== "admin" && user.role !== "god") {
    redirect("/?forbidden=1");
  }

  return user.role;
}

function renderSection(section: Section) {
  if (section === "services") return <ServicesAdminPanel />;
  if (section === "profiles") return <ProfilesAdminPanel />;
  if (section === "users") return <UsersAdminPanel />;
  if (section === "tasks") return <TaskGroupsAdminPanel />;
  if (section === "reports") return <ReportsManifestAdminPanel />;
  if (section === "backups") return <DatabaseBackupsAdminPanel />;
  return <PasswordPadAdminPage />;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const role = await getAdminUserRole();
  const params = searchParams ? await searchParams : undefined;
  const requestedSectionRaw = Array.isArray(params?.section) ? params?.section[0] : params?.section;
  const requestedSection = normalizeSection(requestedSectionRaw);

  const allowedSections = getAllowedSections(role);
  const visibleGroups = getVisibleSectionGroups(role);
  const defaultSection = getDefaultSection(role);
  const allowedSet = new Set(allowedSections);

  if (requestedSection && !allowedSet.has(requestedSection)) {
    redirect(`/admin?section=${defaultSection}`);
  }

  const section = requestedSection && allowedSet.has(requestedSection) ? requestedSection : defaultSection;

  return (
    <main className="flex h-full w-full gap-4 py-3">
      <aside className="h-full w-80 shrink-0 rounded-2xl border border-slate-200/80 bg-white/70 p-3 backdrop-blur-sm">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="text-sm font-semibold text-slate-800">Администрирование</div>
        </div>

        <nav className="space-y-3">
          {visibleGroups.map((group) => (
            <div key={group.title} className="rounded-2xl border border-slate-200/80 bg-white/75 p-2">
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
        {renderSection(section)}
      </section>
    </main>
  );
}
