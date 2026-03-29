"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "@/lib/roles";

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

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const createRoleOptions: UserRole[] = me?.role === "god" ? ["user", "admin", "god"] : ["user", "admin"];

  return (
    <div className="h-full overflow-auto p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Пользователи</h2>

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя"
          className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm"
        />
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          className="rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm"
          >
            {createRoleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={createUser}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      </div>

      {loading && <div className="mb-3 text-sm text-gray-500">Загрузка...</div>}
      {error && <div className="mb-3 text-sm text-rose-700">{error}</div>}
      {message && <div className="mb-3 text-sm text-emerald-700">{message}</div>}

      <div className="space-y-2">
        {users.map((item) => {
          const isSelf = me?.id === item.id;
          const canDelete =
            !isSelf && (me?.role === "god" || (me?.role === "admin" && item.role !== "god"));
          const canEditRole = canDelete;

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
                <select
                  value={item.role}
                  disabled={!canEditRole || saving || updatingRoleId === item.id}
                  onChange={(e) => updateUserRole(item, e.target.value as UserRole)}
                  className="rounded-lg border border-slate-300 bg-white/70 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100/80"
                  title={isSelf ? "Нельзя менять свою роль" : undefined}
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

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
    </div>
  );
}
