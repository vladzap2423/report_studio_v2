"use client";

import { useState, useRef, useCallback } from "react";

export default function LoadPage() {
  const [password, setPassword] = useState("");
  const [id, setId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handlePicked = useCallback((picked: File[]) => {
    setFiles(picked);
  }, []);

  const uploadScripts = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!files.length) return setError("Выберите файлы скрипта.");
    if (!id.trim()) return setError("Укажите ID скрипта.");
    if (password !== "Zx44tfW") return setError("Неверный пароль.");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("scriptId", id.trim());
      fd.append("password", password);
      if (overwrite) fd.append("overwrite", "1");
      for (const f of files) fd.append("files", f, (f as any).webkitRelativePath || f.name);

      const res = await fetch("/api/scripts/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setSuccess("Скрипт загружен.");
      setFiles([]);
      setId("");
      setPassword("");
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("Не удалось загрузить скрипт.");
    } finally {
      setLoading(false);
    }
  }, [files, id, password, overwrite]);

  return (
      <div className="mx-auto max-w-3xl px-6 py-14 bg-gray-50/50 rounded-4xl pt-50">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Загрузка скрипта</h1>

        <div className="grid gap-3 sm:grid-cols-[120px_1fr] sm:items-center mb-4">
          <label className="text-sm font-medium text-slate-700">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[120px_1fr] sm:items-center mb-4">
          <label className="text-sm font-medium text-slate-700">ID скрипта</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-slate-600">
          <div>Файлы: {files.length ? `${files.length} шт.` : "не выбраны"}</div>
          <button
            type="button"
            onClick={onPickClick}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
          >
            Выбрать файлы
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              if (!picked.length) return;
              handlePicked(picked);
            }}
            {...({ webkitdirectory: "true"} as any)}
          />
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            id="overwrite"
            className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
          />
          <label htmlFor="overwrite" className="text-sm text-slate-700">Перезаписать, если существует</label>
        </div>

        {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {success && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

        <button
          type="button"
          onClick={uploadScripts}
          disabled={loading}
          className="rounded-2xl bg-emerald-700 px-6 py-3 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading ? "Загрузка..." : "Загрузить"}
        </button>
      </div>
  );
}