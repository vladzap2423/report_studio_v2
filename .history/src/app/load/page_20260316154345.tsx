// src/app/load/page.tsx
"use client";

import { useState } from "react";

export default function LoadPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const handleLoad = async () => {
    setLoading(true);
    setStatus("Загрузка...");

    try {
      const res = await fetch("/api/load-script", { method: "POST" });
      if (!res.ok) throw new Error("Ошибка загрузки");

      setStatus("Скрипт успешно загружен");
    } catch (err) {
      console.error(err);
      setStatus("Ошибка при загрузке скрипта");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-screen-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Загрузка скрипта</h1>
      <button
        onClick={handleLoad}
        disabled={loading}
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Загрузка..." : "Загрузить скрипт"}
      </button>
      {status && <p className="mt-4 text-gray-700">{status}</p>}
    </div>
  );
}