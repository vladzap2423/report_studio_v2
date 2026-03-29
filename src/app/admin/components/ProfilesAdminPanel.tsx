"use client";

import { useCallback, useEffect, useState } from "react";

type Profile = {
  id: number;
  name: string;
};

export default function ProfilesAdminPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [newProfile, setNewProfile] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
        <input
          value={newProfile}
          onChange={(e) => setNewProfile(e.target.value)}
          placeholder="Новый профиль"
          className="w-full rounded-xl border border-slate-300 bg-white/70 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={saving}
          onClick={createProfile}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Добавить
        </button>
      </div>

      {loading && <div className="mb-3 text-sm text-gray-500">Загрузка...</div>}
      {error && <div className="mb-3 text-sm text-rose-700">{error}</div>}
      {message && <div className="mb-3 text-sm text-emerald-700">{message}</div>}

      <div className="space-y-2">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-2"
          >
            <input
              value={drafts[profile.id] ?? ""}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [profile.id]: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white/70 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => renameProfile(profile.id)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Сохранить
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => deleteProfile(profile.id)}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
