"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VirtualItem, useVirtualizer } from "@tanstack/react-virtual";
import AppSelect from "@/app/components/AppSelect";

type Service = {
  id: number;
  code: string | null;
  name: string | null;
  med: number;
  profile: string | null;
};

export default function ServicesAdminPanel() {
  const servicesGridClass =
    "grid grid-cols-[minmax(120px,1fr)_minmax(420px,4fr)_minmax(110px,0.8fr)_minmax(220px,1.6fr)_110px] gap-2";

  const [services, setServices] = useState<Service[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const parentRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [resServices, resProfiles] = await Promise.all([
        fetch("/api/services", { cache: "no-store" }),
        fetch("/api/profiles", { cache: "no-store" }),
      ]);

      if (!resServices.ok || !resProfiles.ok) {
        throw new Error("Failed to load data");
      }

      const servicesData = (await resServices.json()) as { services?: Service[] };
      const profileData = (await resProfiles.json()) as string[];

      setServices(Array.isArray(servicesData.services) ? servicesData.services : []);
      setProfiles(Array.isArray(profileData) ? profileData : []);
    } catch (error) {
      console.error(error);
      setServices([]);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveField = async (
    id: number,
    field: "code" | "name" | "med" | "profile",
    value: string | number | null
  ) => {
    try {
      const res = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value }),
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }

      setServices((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (field === "code") return { ...item, code: typeof value === "string" ? value : null };
          if (field === "name") return { ...item, name: typeof value === "string" ? value : null };
          if (field === "med") return { ...item, med: Number(value) || 0 };
          return { ...item, profile: typeof value === "string" ? value : null };
        })
      );
    } catch {
      alert("Не удалось сохранить изменение");
    }
  };

  const deleteService = async (id: number) => {
    if (!confirm("Удалить услугу?")) return;

    try {
      const res = await fetch(`/api/services?id=${id}`, {
        method: "DELETE",
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || "Не удалось удалить услугу");
      }

      setServices((prev) => prev.filter((item) => item.id !== id));
    } catch (error: any) {
      alert(error?.message || "Не удалось удалить услугу");
    }
  };

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const filteredServices = useMemo(() => {
    if (!normalizedQuery) {
      return services;
    }

    return services.filter((item) => {
      const code = (item.code ?? "").toLowerCase();
      const name = (item.name ?? "").toLowerCase();
      return code.includes(normalizedQuery) || name.includes(normalizedQuery);
    });
  }, [normalizedQuery, services]);

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [normalizedQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredServices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      {loading && <div className="mb-4 text-sm text-gray-500">Загрузка данных...</div>}

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setIsEditing((prev) => !prev)}
          className={`rounded-2xl px-4 py-1.5 text-sm font-medium text-white ${
            isEditing ? "bg-amber-600 hover:bg-amber-500" : "bg-slate-900 hover:bg-slate-800"
          }`}
        >
          {isEditing ? "Редактирование включено" : "Редактировать"}
        </button>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Поиск по коду или названию"
          className="ml-auto w-full max-w-sm rounded-2xl border border-slate-300 bg-white/70 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200"
        />
      </div>

      <div className={`${servicesGridClass} rounded-t-lg border border-gray-200 bg-gray-50/90 px-2 py-1 font-medium text-gray-600`}>
        <div>Код услуги</div>
        <div>Название услуги</div>
        <div className="text-center">Медикаменты</div>
        <div>Профиль</div>
        <div className="text-center">Действия</div>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-b-lg border border-t-0 border-gray-200"
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
            const item = filteredServices[virtualRow.index];
            return (
              <div
                key={item.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`${servicesGridClass} items-center border-b border-gray-200 bg-gray-50/70 px-2 hover:bg-gray-50`}
              >
                <input
                  defaultValue={item.code ?? ""}
                  disabled={!isEditing}
                  onBlur={(e) => saveField(item.id, "code", e.target.value)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm focus:border-blue-400 focus:bg-white/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />

                <input
                  defaultValue={item.name ?? ""}
                  disabled={!isEditing}
                  onBlur={(e) => saveField(item.id, "name", e.target.value)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm focus:border-blue-400 focus:bg-white/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />

                <input
                  type="number"
                  min={0}
                  defaultValue={item.med ?? 0}
                  disabled={!isEditing}
                  onBlur={(e) => saveField(item.id, "med", Number(e.target.value) || 0)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-center text-sm focus:border-blue-400 focus:bg-white/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />

                <AppSelect
                  defaultValue={item.profile ?? ""}
                  disabled={!isEditing}
                  onChange={(e) => saveField(item.id, "profile", e.target.value)}
                  wrapperClassName="w-full rounded-xl border border-transparent bg-white/70 text-slate-700 focus-within:border-blue-400"
                  selectClassName="px-1.5 py-0.5 pr-7 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  iconClassName="text-slate-500"
                >
                  <option value="">— не выбран —</option>
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </AppSelect>

                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={!isEditing}
                    onClick={() => deleteService(item.id)}
                    className="rounded-lg border border-rose-300 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredServices.length === 0 && !loading && (
        <p className="mt-8 text-center text-gray-500">Нет записей</p>
      )}

      <p className="mt-3 text-right text-sm text-gray-500">
        Показано: {filteredServices.length} из {services.length}
      </p>
    </div>
  );
}
