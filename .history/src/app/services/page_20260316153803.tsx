// src/app/services/page.tsx
"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useVirtualizer, VirtualItem } from "@tanstack/react-virtual";

type Service = {
  ID: number;
  price_code: string | null;
  price_service: string | null;
  okmu_code: string | null;
  okmu_service: string | null;
  medicaments: number;
  profile: string | null;
};

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [showOnlyUsed, setShowOnlyUsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const parentRef = useRef<HTMLDivElement>(null);

  // Загрузка данных
  const loadData = async () => {
    try {
      const [resServices, resProfiles] = await Promise.all([
        fetch("/api/services"),
        fetch("/api/profiles"),
      ]);

      if (!resServices.ok || !resProfiles.ok) throw new Error("Ошибка загрузки");

      const data = await resServices.json();
      const profList = await resProfiles.json();

      setServices(Array.isArray(data.services) ? data.services : []);
      setProfiles(Array.isArray(profList) ? profList : ["Терапия", "Хирургия", "Другое"]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredServices = useMemo(() => {
    if (!showOnlyUsed) return services;
    return services.filter(
      (item) =>
        item.okmu_code &&
        item.okmu_code.trim() !== "" &&
        item.okmu_code.trim().toUpperCase() !== "NULL" &&
        item.okmu_code.trim() !== "-"
    );
  }, [services, showOnlyUsed]);

  const saveField = async (id: number, field: keyof Service, value: any) => {
    try {
      const res = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value }),
      });
      if (!res.ok) throw new Error();

      setServices((prev) =>
        prev.map((item) => (item.ID === id ? { ...item, [field]: value } : item))
      );
    } catch {
      alert("Не удалось сохранить изменение");
    }
  };

  // Виртуализация строк
  const rowVirtualizer = useVirtualizer({
    count: filteredServices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      {loading && <div className="mb-4 text-sm text-gray-500">Загрузка данных...</div>}

      <div className="mb-5 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => setShowOnlyUsed(!showOnlyUsed)}
          className={`px-4 py-1.5 text-sm font-medium rounded-2xl border transition-all
          ${
            showOnlyUsed
              ? "border-blue-600 text-blue-700 bg-white hover:bg-blue-50"
              : "border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
          }`}
        >
          {showOnlyUsed ? "Показать все" : "Только используемые"}
        </button>
        <span className="text-sm text-gray-600">
          Показано: {filteredServices.length} из {services.length}
        </span>
      </div>

      {/* Заголовок таблицы */}
      <div className="grid grid-cols-[180px_380px_180px_380px_100px_200px] gap-2 bg-gray-50 border border-gray-200 rounded-t-lg px-2 py-1 font-medium text-gray-600">
        <div>Код прайса</div>
        <div>Услуга прайса</div>
        <div>Код ОК МУ</div>
        <div>Услуга ОК МУ</div>
        <div className="text-center">Медикаменты</div>
        <div>Профиль</div>
      </div>

      {/* Виртуализированные строки */}
      <div
        ref={parentRef}
        className="overflow-y-auto border border-t-0 border-gray-200 rounded-b-lg"
        style={{ height: "600px" }}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
            const item = filteredServices[virtualRow.index];
            return (
              <div
                key={item.ID}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="grid grid-cols-[180px_300px_180px_300px_100px_200px] gap-2 border-b border-gray-200 items-center px-2 hover:bg-gray-50"
              >
                <input
                  defaultValue={item.price_code ?? ""}
                  onBlur={(e) => saveField(item.ID, "price_code", e.target.value)}
                  className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <input
                  defaultValue={item.price_service ?? ""}
                  onBlur={(e) => saveField(item.ID, "price_service", e.target.value)}
                  className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <input
                  defaultValue={item.okmu_code ?? ""}
                  onBlur={(e) => saveField(item.ID, "okmu_code", e.target.value)}
                  className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <input
                  defaultValue={item.okmu_service ?? ""}
                  onBlur={(e) => saveField(item.ID, "okmu_service", e.target.value)}
                  className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <input
                  type="number"
                  defaultValue={item.medicaments ?? 0}
                  onBlur={(e) =>
                    saveField(item.ID, "medicaments", Number(e.target.value) || 0)
                  }
                  className="w-full text-center border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <select
                  defaultValue={item.profile ?? ""}
                  onChange={(e) => saveField(item.ID, "profile", e.target.value)}
                  className="w-full border border-transparent bg-white px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:outline-none"
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
        <p className="mt-8 text-center text-gray-500">Нет записей, удовлетворяющих фильтру</p>
      )}

      <p className="mt-4 text-sm text-gray-500 text-right">
        Всего в базе: {services.length}
      </p>
    </div>
  );
}