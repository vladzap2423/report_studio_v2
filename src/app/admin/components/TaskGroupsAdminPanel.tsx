"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@/lib/roles";

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

export default function TaskGroupsAdminPanel() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [candidateId, setCandidateId] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { user?: { id: number; role: UserRole } | null };
      if (data.user) {
        setMe({ id: data.user.id, role: data.user.role });
      }
    } catch {
      // ignore
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/task-groups", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; groups?: TaskGroup[] }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить группы");
      }
      const nextGroups = Array.isArray(body?.groups) ? body.groups : [];
      setGroups(nextGroups);
      setSelectedGroupId((prev) => {
        if (prev && nextGroups.some((group) => group.id === prev)) return prev;
        return nextGroups[0]?.id ?? null;
      });
    } catch (e: any) {
      setGroups([]);
      setError(e?.message || "Не удалось загрузить группы");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { users?: UserItem[] };
      setUsers(Array.isArray(body.users) ? body.users : []);
    } catch {
      // ignore
    }
  }, []);

  const loadMembers = useCallback(async (groupId: number) => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/task-groups/members?groupId=${groupId}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; members?: GroupMember[] }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить участников");
      }
      setMembers(Array.isArray(body?.members) ? body.members : []);
    } catch (e: any) {
      setMembers([]);
      setError(e?.message || "Не удалось загрузить участников");
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
    loadGroups();
  }, [loadMe, loadGroups]);

  useEffect(() => {
    if (me?.role === "god") {
      loadUsers();
    } else {
      setUsers([]);
    }
  }, [loadUsers, me?.role]);

  useEffect(() => {
    if (!selectedGroupId) {
      setMembers([]);
      return;
    }
    loadMembers(selectedGroupId);
  }, [loadMembers, selectedGroupId]);

  const canManage = me?.role === "god";

  const availableUsers = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.id));
    return users.filter((user) => !memberIds.has(user.id));
  }, [members, users]);

  useEffect(() => {
    if (availableUsers.length === 0) {
      setCandidateId(null);
      return;
    }
    setCandidateId((prev) => (prev && availableUsers.some((item) => item.id === prev) ? prev : availableUsers[0].id));
  }, [availableUsers]);

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
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
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
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось обновить группу");
      }
      setGroups((prev) =>
        prev.map((item) => (item.id === group.id ? { ...item, is_active: nextActive } : item))
      );
      setMessage(nextActive ? "Группа активирована" : "Группа деактивирована");
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить группу");
    } finally {
      setSaving(false);
    }
  };

  const addMember = async () => {
    if (!canManage || !selectedGroupId || !candidateId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/task-groups/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroupId,
          userId: candidateId,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; members?: GroupMember[] }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось добавить участника");
      }
      setMembers(Array.isArray(body?.members) ? body.members : []);
      setMessage("Пользователь добавлен в группу");
    } catch (e: any) {
      setError(e?.message || "Не удалось добавить участника");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (userId: number) => {
    if (!canManage || !selectedGroupId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/task-groups/members?groupId=${selectedGroupId}&userId=${userId}`,
        { method: "DELETE" }
      );
      const body = (await res.json().catch(() => null)) as
        | { error?: string; members?: GroupMember[] }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось удалить участника");
      }
      setMembers(Array.isArray(body?.members) ? body.members : []);
      setMessage("Пользователь удален из группы");
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить участника");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Группы задач</h2>

      {!canManage && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Управление группами и участниками доступно только пользователю с ролью god.
        </div>
      )}

      {error && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_170px]">
        <input
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
          placeholder="Название группы"
          disabled={!canManage}
          className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100/80"
        />
        <input
          value={newGroupDescription}
          onChange={(event) => setNewGroupDescription(event.target.value)}
          placeholder="Описание (опционально)"
          disabled={!canManage}
          className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100/80"
        />
        <button
          type="button"
          onClick={createGroup}
          disabled={!canManage || saving || !newGroupName.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Создать группу
        </button>
      </div>

      {loading && <div className="mb-3 text-sm text-slate-500">Загрузка групп...</div>}

      <div className="mb-4 grid gap-2">
        {groups.map((group) => {
          const active = selectedGroupId === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedGroupId(group.id)}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div>
                <div className="text-sm font-medium">{group.name}</div>
                <div className={`text-xs ${active ? "text-white/80" : "text-slate-500"}`}>
                  {group.description || "Без описания"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    group.is_active
                      ? active
                        ? "border-white/40 text-white"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : active
                        ? "border-white/40 text-white/80"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {group.is_active ? "Активна" : "Отключена"}
                </span>
                {canManage && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleGroupActive(group, !group.is_active);
                    }}
                    className={`rounded-lg px-2 py-1 text-xs ${
                      active ? "bg-white/15 text-white hover:bg-white/25" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {group.is_active ? "Выключить" : "Включить"}
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedGroupId ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">Участники выбранной группы</div>

          {canManage && (
            <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px]">
              <select
                value={candidateId || ""}
                onChange={(event) => setCandidateId(Number(event.target.value) || null)}
                disabled={saving || availableUsers.length === 0}
                className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100/80"
              >
                {availableUsers.length === 0 && <option value="">Нет доступных пользователей</option>}
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.username}) [{user.role}]
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addMember}
                disabled={saving || !candidateId || availableUsers.length === 0}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Добавить в группу
              </button>
            </div>
          )}

          {loadingMembers ? (
            <div className="text-sm text-slate-500">Загрузка участников...</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-slate-500">В группе пока нет участников.</div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="text-sm text-slate-800">
                    {member.name} ({member.username}) [{member.role}]
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void removeMember(member.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
          Выберите группу, чтобы управлять участниками.
        </div>
      )}
    </div>
  );
}
