"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "@/lib/roles";
import AppSelect from "@/app/components/AppSelect";
import { useToastSync } from "@/app/components/AppToastProvider";
import EditModeButton from "@/app/components/EditModeButton";

type UserItem = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  created_at: string;
};

type CurrentUser = {
  id: number;
  role: UserRole;
};

export default function UsersAdminPanel() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [updatingPasswordId, setUpdatingPasswordId] = useState<number | null>(null);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;

      const data = (await res.json()) as {
        user?: { id: number; role: UserRole } | null;
      };

      if (data.user) {
        setMe({ id: data.user.id, role: data.user.role });
      }
    } catch {
      // ignore
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Failed to load users");
      }

      const data = (await res.json()) as { users?: UserItem[] };
      const nextUsers = Array.isArray(data.users) ? data.users : [];
      setUsers(nextUsers);
    } catch (e: any) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
    loadUsers();
  }, [loadMe, loadUsers]);

  const createUser = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          password,
          role,
        }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Failed to create user");
      }

      setName("");
      setUsername("");
      setPassword("");
      setRole("user");
      setIsCreateModalOpen(false);
      setMessage("User created");
      await loadUsers();
    } catch (e: any) {
      setError(e?.message || "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (user: UserItem) => {
    if (!confirm(`Delete user ${user.username}?`)) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/users?id=${user.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Failed to delete user");
      }

      setMessage("User deleted");
      await loadUsers();
    } catch (e: any) {
      setError(e?.message || "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  const updateUserRole = async (user: UserItem, nextRole: UserRole) => {
    if (nextRole === user.role) return;

    const prevRole = user.role;
    setUpdatingRoleId(user.id);
    setError(null);
    setMessage(null);
    setUsers((prev) =>
      prev.map((item) => (item.id === user.id ? { ...item, role: nextRole } : item))
    );

    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, role: nextRole }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Failed to update role");
      }

      setMessage("Role updated");
      await loadUsers();
    } catch (e: any) {
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? { ...item, role: prevRole } : item))
      );
      setError(e?.message || "Failed to update role");
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const updateUserPassword = async (user: UserItem) => {
    const nextPassword = (passwordDrafts[user.id] || "").trim();
    if (!nextPassword) {
      setError("Введите новый пароль");
      return;
    }

    setUpdatingPasswordId(user.id);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, password: nextPassword }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Failed to update password");
      }

      setPasswordDrafts((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      setMessage("Пароль обновлён");
    } catch (e: any) {
      setError(e?.message || "Failed to update password");
    } finally {
      setUpdatingPasswordId(null);
    }
  };

  const createRoleOptions: UserRole[] = me?.role === "god" ? ["user", "admin", "god"] : ["user", "admin"];

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-900">Пользователи</h2>
        <div className="flex items-center gap-2">
          <EditModeButton active={isEditing} onClick={() => setIsEditing((prev) => !prev)} />
          <button
            type="button"
            disabled={saving || !isEditing}
            onClick={() => {
              setError(null);
              setMessage(null);
              setName("");
              setUsername("");
              setPassword("");
              setRole("user");
              setIsCreateModalOpen(true);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xl leading-none text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Добавить пользователя"
            title="Добавить пользователя"
          >
            +
          </button>
        </div>
      </div>

      {loading && <div className="mb-3 text-sm text-gray-500">Загрузка...</div>}

      <div className="space-y-2">
        {users.map((item) => {
          const isSelf = me?.id === item.id;
          const canDelete =
            isEditing && !isSelf && (me?.role === "god" || (me?.role === "admin" && item.role !== "god"));
          const canEditRole = canDelete;
          const canResetPassword =
            isEditing && (me?.role === "god" || (me?.role === "admin" && item.role !== "god"));

          const roleOptions: UserRole[] =
            me?.role === "god"
              ? ["user", "admin", "god"]
              : item.role === "god"
                ? ["god"]
                : ["user", "admin"];

          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/70 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-slate-900">
                  {item.name} ({item.username})
                </div>
                <div className="text-xs text-slate-500">
                  role: {item.role} | created: {new Date(item.created_at).toLocaleString()}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={passwordDrafts[item.id] || ""}
                  disabled={!canResetPassword || saving || updatingPasswordId === item.id}
                  onChange={(e) =>
                    setPasswordDrafts((prev) => ({
                      ...prev,
                      [item.id]: e.target.value,
                    }))
                  }
                  placeholder="Новый пароль"
                  className="w-40 rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={
                    !canResetPassword ||
                    saving ||
                    updatingPasswordId === item.id ||
                    !(passwordDrafts[item.id] || "").trim()
                  }
                  onClick={() => updateUserPassword(item)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Сбросить пароль
                </button>

                <AppSelect
                  value={item.role}
                  disabled={!canEditRole || saving || updatingRoleId === item.id}
                  onChange={(e) => updateUserRole(item, e.target.value as UserRole)}
                  wrapperClassName="rounded-2xl border border-slate-300 bg-white/70 text-slate-700"
                  selectClassName="px-3 py-2 pr-9 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  title={isSelf ? "Нельзя менять свою роль" : undefined}
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </AppSelect>

                <button
                  type="button"
                  disabled={!canDelete || saving || updatingRoleId === item.id}
                  onClick={() => deleteUser(item)}
                  className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title={isSelf ? "Нельзя удалить себя" : undefined}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
          onClick={() => {
            if (saving) return;
            setIsCreateModalOpen(false);
            setName("");
            setUsername("");
            setPassword("");
            setRole("user");
          }}
        >
          <div
            className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Новый пользователь
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">Добавить пользователя</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Имя"
                disabled={saving}
                className="rounded-2xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                disabled={saving}
                className="rounded-2xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                disabled={saving}
                className="rounded-2xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <AppSelect
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                wrapperClassName="rounded-2xl border border-slate-300 bg-white/80 text-slate-700"
                selectClassName="px-4 py-3 pr-9 text-sm text-slate-700"
              >
                {createRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </AppSelect>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setName("");
                  setUsername("");
                  setPassword("");
                  setRole("user");
                }}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving || !name.trim() || !username.trim() || !password.trim()}
                onClick={createUser}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Сохранение..." : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
