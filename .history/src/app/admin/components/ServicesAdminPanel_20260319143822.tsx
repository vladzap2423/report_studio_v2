"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VirtualItem, useVirtualizer } from "@tanstack/react-virtual";

type Service = {
  id: number;
  code: string | null;
  name: string | null;
  med: number;
  profile: string | null;
};

export default function ServicesAdminPanel() {
  const [services, setServices] = useState<Service[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [showOnlyUsed, setShowOnlyUsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

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

  const filteredServices = useMemo(() => {
    if (!showOnlyUsed) return services;
    return services.filter((item) => {
      const code = String(item.code ?? "").trim();
      return code.length > 0;
    });
  }, [services, showOnlyUsed]);

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

  const runImport = async (file: File) => {
    setImportError(null);
    setImportMessage(null);
    setImportLoading(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/services/import", {
        method: "POST",
        body: form,
      });

      const body = (await res.json().catch(() => null)) as
        | { inserted?: number; error?: string }
        | null;

      if (!res.ok) {
        throw new Error(body?.error || "Не удалось загрузить данные");
      }

      setImportMessage(`Импорт завершен. Загружено строк: ${body?.inserted || 0}`);
      await loadData();
    } catch (error: any) {
      setImportError(error?.message || "Не удалось загрузить данные");
    } finally {
      setImportLoading(false);
    }
  };

  const onImportPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      setImportError("Нужен Excel файл .xlsx или .xls");
      event.target.value = "";
      return;
    }

    await runImport(file);
    event.target.value = "";
  };

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
          onClick={() => setShowOnlyUsed((v) => !v)}
          className={`rounded-2xl border px-4 py-1.5 text-sm font-medium transition-all ${
            showOnlyUsed
              ? "border-blue-600 bg-white text-blue-700 hover:bg-blue-50"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {showOnlyUsed ? "Показать все" : "Только с кодом"}
        </button>

        <span className="text-sm text-gray-600">
          Показано: {filteredServices.length} из {services.length}
        </span>

        <button
          type="button"
          disabled={importLoading}
          onClick={() => importFileRef.current?.click()}
          className="rounded-2xl bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {importLoading ? "Загрузка..." : "Подгрузить данные"}
        </button>

        <input
          ref={importFileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onImportPick}
        />
      </div>

      <p className="mb-3 text-xs text-gray-500">
        Формат Excel: первая строка заголовки. Обязательные колонки: code, name, med, profile.
        Поддерживаются и русские: Код прайса, Услуга, Медикаменты, Профиль.
        Импорт полностью заменяет таблицу services.
      </p>

      {importMessage && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {importMessage}
        </div>
      )}

      {importError && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {importError}
        </div>
      )}

      <div className="grid grid-cols-[120px_560px_120px_260px] gap-2 rounded-t-lg border border-gray-200 bg-gray-50/90 px-2 py-1 font-medium text-gray-600">
        <div>Код услуги</div>
        <div>Название услуги</div>
        <div className="text-center">Мед</div>
        <div>Профиль</div>
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
                className="grid grid-cols-[120px_560px_120px_260px] items-center gap-2 border-b border-gray-200 bg-gray-50/70 px-2 hover:bg-gray-50"
              >
                <input
                  defaultValue={item.code ?? ""}
                  onBlur={(e) => saveField(item.id, "code", e.target.value)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />

                <input
                  defaultValue={item.name ?? ""}
                  onBlur={(e) => saveField(item.id, "name", e.target.value)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />

                <input
                  type="number"
                  min={0}
                  defaultValue={item.med ?? 0}
                  onBlur={(e) => saveField(item.id, "med", Number(e.target.value) || 0)}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-center text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />

                <select
                  defaultValue={item.profile ?? ""}
                  onChange={(e) => saveField(item.id, "profile", e.target.value)}
                  className="w-full rounded border border-transparent bg-white px-1.5 py-0.5 text-sm focus:border-blue-400 focus:outline-none"
                >
                  <option value="">— не выбран —</option>
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {filteredServices.length === 0 && !loading && (
        <p className="mt-8 text-center text-gray-500">Нет записей под текущий фильтр</p>
      )}

      <p className="mt-3 text-right text-sm text-gray-500">Всего в базе: {services.length}</p>
    </div>
  );
}
