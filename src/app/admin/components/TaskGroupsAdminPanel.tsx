"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@/lib/roles";
import { useToastSync } from "@/app/components/AppToastProvider";

type CurrentUser = {
  id: number;
  role: UserRole;
};

type TaskGroup = {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

type GroupMember = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
};

type UserItem = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  created_at: string;
};

const ROLE_LABELS: Record<UserRole, string> = {
  user: "Сотрудник",
  admin: "Администратор",
  god: "God",
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizeId(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCurrentUser(user: CurrentUser | null) {
  return user ? { ...user, id: normalizeId(user.id) } : null;
}

function normalizeTaskGroup(group: TaskGroup): TaskGroup {
  return {
    ...group,
    id: normalizeId(group.id),
    created_by: group.created_by == null ? null : normalizeId(group.created_by),
  };
}

function normalizeGroupMember(member: GroupMember): GroupMember {
  return {
    ...member,
    id: normalizeId(member.id),
  };
}

function normalizeUserItem(user: UserItem): UserItem {
  return {
    ...user,
    id: normalizeId(user.id),
  };
}

async function parseJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cls(
        "h-4 w-4 transition-transform duration-200",
        expanded ? "rotate-90" : "rotate-0"
      )}
    >
      <path
        d="M7 5l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 5l10 10M15 5L5 15"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function TaskGroupsAdminPanel() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<number, GroupMember[]>>({});

  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [draftMemberIds, setDraftMemberIds] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingMembersGroupId, setLoadingMembersGroupId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  const canManage = me?.role === "god";

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await parseJson<{ user?: CurrentUser | null }>(res)) || null;
      setMe(normalizeCurrentUser(data?.user || null));
    } catch {
      // ignore
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/task-groups", { cache: "no-store" });
      const body = await parseJson<{ error?: string; groups?: TaskGroup[] }>(res);
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить группы");
      }

      const nextGroups = Array.isArray(body?.groups) ? body.groups.map(normalizeTaskGroup) : [];
      const nextIds = new Set(nextGroups.map((group) => group.id));

      setGroups(nextGroups);
      setMembersByGroup((prev) => {
        const next: Record<number, GroupMember[]> = {};
        Object.entries(prev).forEach(([groupId, members]) => {
          const numericId = Number(groupId);
          if (nextIds.has(numericId)) {
            next[numericId] = members;
          }
        });
        return next;
      });
      setExpandedGroupId((prev) =>
        prev && nextGroups.some((group) => group.id === prev) ? prev : null
      );
      setEditingGroupId((prev) =>
        prev && nextGroups.some((group) => group.id === prev) ? prev : null
      );
    } catch (e: any) {
      setGroups([]);
      setMembersByGroup({});
      setExpandedGroupId(null);
      setEditingGroupId(null);
      setError(e?.message || "Не удалось загрузить группы");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const body = await parseJson<{ error?: string; users?: UserItem[] }>(res);
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить пользователей");
      }
      setUsers(Array.isArray(body?.users) ? body.users.map(normalizeUserItem) : []);
    } catch (e: any) {
      setUsers([]);
      setError(e?.message || "Не удалось загрузить пользователей");
    }
  }, []);

  const loadGroupMembers = useCallback(async (groupId: number, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoadingMembersGroupId(groupId);
    }

    try {
      const res = await fetch(`/api/task-groups/members?groupId=${groupId}`, {
        cache: "no-store",
      });
      const body = await parseJson<{ error?: string; members?: GroupMember[] }>(res);
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить участников");
      }
      const members = Array.isArray(body?.members) ? body.members.map(normalizeGroupMember) : [];
      setMembersByGroup((prev) => ({ ...prev, [groupId]: members }));
      return members;
    } catch (e: any) {
      setMembersByGroup((prev) => ({ ...prev, [groupId]: [] }));
      setError(e?.message || "Не удалось загрузить участников");
      return [] as GroupMember[];
    } finally {
      if (!silent) {
        setLoadingMembersGroupId((prev) => (prev === groupId ? null : prev));
      }
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void loadGroups();
  }, [loadMe, loadGroups]);

  useEffect(() => {
    if (canManage) {
      void loadUsers();
    } else {
      setUsers([]);
    }
  }, [canManage, loadUsers]);

  useEffect(() => {
    if (!expandedGroupId) return;
    void loadGroupMembers(expandedGroupId);
  }, [expandedGroupId, loadGroupMembers]);

  const filteredUsers = useMemo(() => {
    if (!editingGroupId) return [];

    const checked = new Set(draftMemberIds);
    const query = memberSearch.trim().toLowerCase();

    return [...users]
      .filter((user) => {
        if (!query) return true;
        const haystack = `${user.name} ${user.username}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const checkedDiff = Number(checked.has(b.id)) - Number(checked.has(a.id));
        if (checkedDiff !== 0) return checkedDiff;
        return a.name.localeCompare(b.name, "ru");
      });
  }, [draftMemberIds, editingGroupId, memberSearch, users]);

  const hasDraftChanges = useMemo(() => {
    if (!editingGroupId) return false;
    const currentIds = new Set((membersByGroup[editingGroupId] ?? []).map((member) => member.id));
    if (currentIds.size !== draftMemberIds.length) return true;
    return draftMemberIds.some((id) => !currentIds.has(id));
  }, [draftMemberIds, editingGroupId, membersByGroup]);

  const editingGroup = useMemo(
    () => groups.find((group) => group.id === editingGroupId) || null,
    [editingGroupId, groups]
  );

  const createGroup = async () => {
    if (!canManage) return;
    if (!newGroupName.trim()) {
      setError("Введите название группы");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/task-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newGroupName.trim(),
          description: newGroupDescription.trim(),
        }),
      });
      const body = await parseJson<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось создать группу");
      }

      setNewGroupName("");
      setNewGroupDescription("");
      setMessage("Группа создана");
      await loadGroups();
    } catch (e: any) {
      setError(e?.message || "Не удалось создать группу");
    } finally {
      setSaving(false);
    }
  };

  const toggleGroupActive = async (group: TaskGroup, nextActive: boolean) => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/task-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: group.id, isActive: nextActive }),
      });
      const body = await parseJson<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось обновить группу");
      }
      setGroups((prev) =>
        prev.map((item) => (item.id === group.id ? { ...item, is_active: nextActive } : item))
      );
      setMessage(nextActive ? "Группа активирована" : "Группа отключена");
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить группу");
    } finally {
      setSaving(false);
    }
  };

  const toggleExpandedGroup = (groupId: number) => {
    setExpandedGroupId((prev) => (prev === groupId ? null : groupId));
  };

  const openMemberEditor = async (groupId: number) => {
    if (!canManage) return;

    setError(null);
    setMessage(null);
    const currentMembers = membersByGroup[groupId] ?? (await loadGroupMembers(groupId, { silent: true }));
    setEditingGroupId(groupId);
    setDraftMemberIds(currentMembers.map((member) => member.id));
    setMemberSearch("");
  };

  const cancelMemberEditor = () => {
    setEditingGroupId(null);
    setDraftMemberIds([]);
    setMemberSearch("");
  };

  const toggleDraftMember = (userId: number) => {
    setDraftMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const saveMemberSelection = async (groupId: number) => {
    if (!canManage) return;

    const currentMemberIds = new Set((membersByGroup[groupId] ?? []).map((member) => member.id));
    const nextMemberIds = new Set(draftMemberIds);

    const toAdd = [...nextMemberIds].filter((id) => !currentMemberIds.has(id));
    const toRemove = [...currentMemberIds].filter((id) => !nextMemberIds.has(id));

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const userId of toAdd) {
        const res = await fetch("/api/task-groups/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, userId }),
        });
        const body = await parseJson<{ error?: string }>(res);
        if (!res.ok) {
          throw new Error(body?.error || "Не удалось добавить участника");
        }
      }

      for (const userId of toRemove) {
        const res = await fetch(`/api/task-groups/members?groupId=${groupId}&userId=${userId}`, {
          method: "DELETE",
        });
        const body = await parseJson<{ error?: string }>(res);
        if (!res.ok) {
          throw new Error(body?.error || "Не удалось удалить участника");
        }
      }

      const refreshedMembers = await loadGroupMembers(groupId, { silent: true });
      setMembersByGroup((prev) => ({ ...prev, [groupId]: refreshedMembers }));
      setEditingGroupId(null);
      setDraftMemberIds([]);
      setMemberSearch("");
      setMessage("Состав группы обновлен");
    } catch (e: any) {
      await loadGroupMembers(groupId, { silent: true });
      setError(e?.message || "Не удалось обновить состав группы");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-6xl">
        {!canManage && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Управление группами и участниками доступно только пользователю с ролью god.
          </div>
        )}

        <div className="mb-5 rounded-[28px] border border-slate-200 bg-white/85 p-5 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Создание новой группы</div>
              <div className="text-xs text-slate-500">Новая группа появится в списке ниже.</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_180px]">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Название группы"
              disabled={!canManage}
              className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
            />
            <input
              value={newGroupDescription}
              onChange={(event) => setNewGroupDescription(event.target.value)}
              placeholder="Краткое описание или назначение группы"
              disabled={!canManage}
              className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
            />
            <button
              type="button"
              onClick={createGroup}
              disabled={!canManage || saving || !newGroupName.trim()}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Создать группу
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-500">
            Загрузка групп...
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/75 px-6 py-10 text-center text-sm text-slate-500">
            Групп пока нет. Создайте первую группу, и она появится в списке.
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const expanded = expandedGroupId === group.id;
              const isLoadingMembers = loadingMembersGroupId === group.id;
              const groupMembers = membersByGroup[group.id] ?? [];

              return (
                <article
                  key={group.id}
                  className={cls(
                    "overflow-hidden rounded-[28px] border bg-white/85 shadow-[0_12px_35px_rgba(15,23,42,0.05)] transition",
                    expanded ? "border-slate-300" : "border-slate-200"
                  )}
                >
                  <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
                    <button
                      type="button"
                      onClick={() => toggleExpandedGroup(group.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div
                        className={cls(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                          expanded
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-300 bg-slate-50 text-slate-500"
                        )}
                      >
                        <ChevronIcon expanded={expanded} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">{group.name}</div>
                          <span
                            className={cls(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                              group.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-rose-200 bg-rose-50 text-rose-700"
                            )}
                          >
                            {group.is_active ? "Активна" : "Отключена"}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {group.description || "Описание группы не указано"}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-2 self-start">
                      {canManage && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void toggleGroupActive(group, !group.is_active)}
                          className={cls(
                            "rounded-xl px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
                            group.is_active
                              ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                              : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          )}
                        >
                          {group.is_active ? "Отключить" : "Включить"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpandedGroup(group.id)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {expanded ? "Свернуть" : "Открыть"}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Состав группы</div>
                          <div className="text-xs text-slate-500">
                            {isLoadingMembers
                              ? "Загрузка участников..."
                              : groupMembers.length > 0
                                ? "Добавленные пользователи группы"
                                : "Пока нет добавленных участников"}
                          </div>
                        </div>

                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void openMemberEditor(group.id)}
                            disabled={saving}
                            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Изменить состав
                          </button>
                        )}
                      </div>

                      {isLoadingMembers ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-sm text-slate-500">
                          Загрузка участников...
                        </div>
                      ) : groupMembers.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-sm text-slate-500">
                          В этой группе пока нет участников.
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {groupMembers.map((member) => (
                            <div
                              key={member.id}
                              className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-slate-900">
                                    {member.name}
                                  </div>
                                  <div className="mt-1 truncate text-xs text-slate-500">@{member.username}</div>
                                </div>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                                  {ROLE_LABELS[member.role]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="flex w-full max-w-3xl flex-col rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-slate-900">Изменение состава группы</div>
                <div className="mt-1 text-sm text-slate-500">{editingGroup.name}</div>
              </div>
              <button
                type="button"
                onClick={cancelMemberEditor}
                aria-label="Закрыть окно изменения состава"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-500">
                Отметьте пользователей, которые должны входить в группу.
              </div>
              <div className="text-sm font-medium text-slate-700">Выбрано: {draftMemberIds.length}</div>
            </div>

            <div className="mt-4">
              <input
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder="Поиск по ФИО или username"
                className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </div>

            <div className="mt-4 max-h-[460px] space-y-2 overflow-auto pr-1">
              {filteredUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Пользователи по текущему поиску не найдены.
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const checked = draftMemberIds.includes(user.id);
                  return (
                    <label
                      key={user.id}
                      className={cls(
                        "flex cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition",
                        checked
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-slate-900">{user.name}</div>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                            {ROLE_LABELS[user.role]}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">@{user.username}</div>
                      </div>

                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraftMember(user.id)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                    </label>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelMemberEditor}
                disabled={saving}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void saveMemberSelection(editingGroup.id)}
                disabled={saving || !hasDraftChanges}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
