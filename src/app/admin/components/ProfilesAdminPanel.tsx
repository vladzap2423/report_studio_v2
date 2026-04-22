"use client";

import { useCallback, useEffect, useState } from "react";
import { useToastSync } from "@/app/components/AppToastProvider";
import EditModeButton from "@/app/components/EditModeButton";

type Profile = {
  id: number;
  name: string;
};

export default function ProfilesAdminPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [newProfile, setNewProfile] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profiles?full=1", { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось загрузить профили");

      const data = (await res.json()) as { profiles?: Profile[] };
      const list = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(list);
      setDrafts(
        list.reduce<Record<number, string>>((acc, item) => {
          acc[item.id] = item.name;
          return acc;
        }, {})
      );
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить профили");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const createProfile = async () => {
    const name = newProfile.trim();
    if (!name) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || "Не удалось создать профиль");

      setNewProfile("");
      setIsCreateModalOpen(false);
      setMessage("Профиль добавлен");
      await loadProfiles();
    } catch (e: any) {
      setError(e?.message || "Не удалось создать профиль");
    } finally {
      setSaving(false);
    }
  };

  const renameProfile = async (id: number) => {
    const name = String(drafts[id] || "").trim();
    if (!name) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || "Не удалось обновить профиль");

      setMessage("Профиль обновлен");
      await loadProfiles();
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить профиль");
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (id: number) => {
    if (!confirm("Удалить профиль? В services профиль будет очищен.")) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/profiles?id=${id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || "Не удалось удалить профиль");

      setMessage("Профиль удален");
      await loadProfiles();
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить профиль");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Профили</h2>

      <div className="mb-4 flex items-center gap-2">
        <EditModeButton active={isEditing} onClick={() => setIsEditing((prev) => !prev)} />
        <button
          type="button"
          disabled={!isEditing}
          onClick={() => {
            setError(null);
            setMessage(null);
            setNewProfile("");
            setIsCreateModalOpen(true);
          }}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xl leading-none text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Добавить профиль"
        >
          +
        </button>
      </div>

      {loading && <div className="mb-3 text-sm text-gray-500">Загрузка...</div>}

      <div className="space-y-2">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-2"
          >
            <input
              value={drafts[profile.id] ?? ""}
              disabled={!isEditing}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [profile.id]: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white/70 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              disabled={saving || !isEditing}
              onClick={() => renameProfile(profile.id)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Сохранить
            </button>
            <button
              type="button"
              disabled={saving || !isEditing}
              onClick={() => deleteProfile(profile.id)}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Удалить
            </button>
          </div>
        ))}
      </div>

      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
          onClick={() => {
            if (saving) return;
            setIsCreateModalOpen(false);
            setNewProfile("");
          }}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Новый профиль
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">Добавить профиль</h3>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Название профиля
              <input
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                placeholder="Введите название профиля"
                disabled={saving}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createProfile();
                  }
                  if (event.key === "Escape" && !saving) {
                    setIsCreateModalOpen(false);
                    setNewProfile("");
                  }
                }}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setNewProfile("");
                }}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving || !newProfile.trim()}
                onClick={createProfile}
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
