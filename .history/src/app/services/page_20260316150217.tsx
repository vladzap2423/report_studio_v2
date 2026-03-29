"use client";

import { useEffect, useState, useMemo  } from "react";
import Link from "next/link";

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
  const [filteredServices, setFilteredServices] = useState<Service[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [showOnlyUsed, setShowOnlyUsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [resServices, resProfiles] = await Promise.all([
        fetch("/api/services"),
        fetch("/api/profiles"),
      ]);

      if (!resServices.ok || !resProfiles.ok) {
        throw new Error("Ошибка загрузки данных");
      }

      const data = await resServices.json();
      const profList = await resProfiles.json();

      setServices(Array.isArray(data) ? data : []);
      setProfiles(
        Array.isArray(profList)
          ? profList
          : ["Терапия", "Хирургия", "Другое"]
      );
    } catch (err) {
      console.error("Ошибка загрузки:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (showOnlyUsed) {
      const filtered = services.filter(
        (item) =>
          item.okmu_code &&
          item.okmu_code.trim() !== "" &&
          item.okmu_code.trim().toUpperCase() !== "NULL" &&
          item.okmu_code.trim() !== "-"
      );
      setFilteredServices(filtered);
    } else {
      setFilteredServices(services);
    }
  }, [showOnlyUsed, services]);

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
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          ← На главную
        </Link>
      </div>

      {loading && (
        <div className="mb-4 text-sm text-gray-500">Загрузка данных...</div>
      )}

      <div className="mb-5 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => setShowOnlyUsed(!showOnlyUsed)}
          className={`px-4 py-1.5 text-sm font-medium rounded-2xl border transition-all duration-200
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

      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-45">
                Код прайса
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-150">
                Услуга прайса
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-45">
                Код ОК МУ
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-150">
                Услуга ОК МУ
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-gray-600 w-15">
                Медикаменты
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-60">
                Профиль
              </th>
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {filteredServices.map((item) => (
              <tr key={item.ID} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 text-sm border-r border-gray-200">
                  <input
                    defaultValue={item.price_code ?? ""}
                    onBlur={(e) =>
                      saveField(item.ID, "price_code", e.target.value)
                    }
                    className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                  />
                </td>

                <td className="px-3 py-1.5 text-sm border-r border-gray-200">
                  <input
                    defaultValue={item.price_service ?? ""}
                    onBlur={(e) =>
                      saveField(item.ID, "price_service", e.target.value)
                    }
                    className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                  />
                </td>

                <td className="px-3 py-1.5 text-sm border-r border-gray-200">
                  <input
                    defaultValue={item.okmu_code ?? ""}
                    onBlur={(e) =>
                      saveField(item.ID, "okmu_code", e.target.value)
                    }
                    className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                  />
                </td>

                <td className="px-3 py-1.5 text-sm border-r border-gray-200">
                  <input
                    defaultValue={item.okmu_service ?? ""}
                    onBlur={(e) =>
                      saveField(item.ID, "okmu_service", e.target.value)
                    }
                    className="w-full border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                  />
                </td>

                <td className="px-3 py-1.5 text-center text-sm border-r border-gray-200">
                  <input
                    type="number"
                    defaultValue={item.medicaments ?? 0}
                    onBlur={(e) =>
                      saveField(
                        item.ID,
                        "medicaments",
                        Number(e.target.value) || 0
                      )
                    }
                    className="w-full text-center border border-transparent bg-transparent px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:bg-white focus:outline-none"
                  />
                </td>

                <td className="px-3 py-1.5 text-sm border-r border-gray-200">
                  <select
                    defaultValue={item.profile ?? ""}
                    onChange={(e) =>
                      saveField(item.ID, "profile", e.target.value)
                    }
                    className="w-full border border-transparent bg-white px-1.5 py-0.5 text-sm rounded focus:border-blue-400 focus:outline-none"
                  >
                    <option value="">— не выбран —</option>
                    {profiles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredServices.length === 0 && !loading && (
        <p className="mt-8 text-center text-gray-500">
          Нет записей, удовлетворяющих фильтру
        </p>
      )}

      <p className="mt-4 text-sm text-gray-500 text-right">
        Всего в базе: {services.length}
      </p>
    </div>
  );
}