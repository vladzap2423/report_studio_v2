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

  // пагинация API
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 1000;

  const parentRef = useRef<HTMLDivElement>(null);

  const loadData = async (page = 1) => {
    try {
      const res = await fetch(`/api/services?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error("Ошибка загрузки");
      const data = await res.json();
      setServices((prev) => [...prev, ...data.services]);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(page);
  }, [page]);

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

    const rowVirtualizer = useVirtualizer({
      count: filteredServices.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 40,
    });

  const saveField = async (id: number, field: keyof Service, value: any) => {
    try {
      const res = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value }),
      });

      if (!res.ok) throw new Error();

      setServices((prev) =>
        prev.map((item) =>
          item.ID === id ? { ...item, [field]: value } : item
        )
      );
    } catch {
      alert("Не удалось сохранить изменение");
    }
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Справочник услуг</h1>
      </div>

      <div className="mb-5 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => setShowOnlyUsed(!showOnlyUsed)}
          className={`px-4 py-1.5 text-sm font-medium rounded-2xl border transition-all ${
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

      <div
        ref={parentRef}
        className="overflow-y-auto border rounded-lg shadow-sm"
        style={{ height: "600px" }}
      >
        <div style={{ height: rowVirtualizer.totalSize, position: "relative" }}>
          {rowVirtualizer.virtualItems.map((virtualRow) => {
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
                className="grid grid-cols-[120px_300px_120px_300px_80px_200px] gap-2 border-b border-gray-200 items-center px-2 hover:bg-gray-50"
              >
                <input
                  defaultValue={item.price_code ?? ""}
                  onBlur={(e) =>
                    saveField(item.ID, "price_code", e.target.value)
                  }
                  className="border border-transparent bg-transparent px-1 py-0.5 rounded focus:border-blue-400 focus:bg-white focus:outline-none text-sm"
                />
                <input
                  defaultValue={item.price_service ?? ""}
                  onBlur={(e) =>
                    saveField(item.ID, "price_service", e.target.value)
                  }
                  className="border border-transparent bg-transparent px-1 py-0.5 rounded focus:border-blue-400 focus:bg-white focus:outline-none text-sm"
                />
                <input
                  defaultValue={item.okmu_code ?? ""}
                  onBlur={(e) =>
                    saveField(item.ID, "okmu_code", e.target.value)
                  }
                  className="border border-transparent bg-transparent px-1 py-0.5 rounded focus:border-blue-400 focus:bg-white focus:outline-none text-sm"
                />
                <input
                  defaultValue={item.okmu_service ?? ""}
                  onBlur={(e) =>
                    saveField(item.ID, "okmu_service", e.target.value)
                  }
                  className="border border-transparent bg-transparent px-1 py-0.5 rounded focus:border-blue-400 focus:bg-white focus:outline-none text-sm"
                />
                <input
                  type="number"
                  defaultValue={item.medicaments ?? 0}
                  onBlur={(e) =>
                    saveField(item.ID, "medicaments", Number(e.target.value))
                  }
                  className="w-full text-center border border-transparent bg-transparent px-1 py-0.5 rounded focus:border-blue-400 focus:bg-white focus:outline-none text-sm"
                />
                <select
                  defaultValue={item.profile ?? ""}
                  onChange={(e) =>
                    saveField(item.ID, "profile", e.target.value)
                  }
                  className="border border-transparent bg-white px-1 py-0.5 rounded focus:border-blue-400 focus:outline-none text-sm"
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

      {!loading && filteredServices.length === 0 && (
        <p className="mt-4 text-center text-gray-500">
          Нет записей, удовлетворяющих фильтру
        </p>
      )}

      <p className="mt-4 text-sm text-gray-500 text-right">
        Всего в базе: {total}
      </p>
    </div>
  );
}