"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type ScriptMeta = {
  id: string;
  title?: string;
  version?: string;
  description?: string;
};

export default function HomePage() {
  const dragDepth = useRef(0);
  const scriptsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");

  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    script: ScriptMeta;
  } | null>(null);

  const accept = ".csv,.xlsx,.xls";

  const hasFiles = files.length > 0;
  const uploadStatus = files.length === 1 ? "Файл загружен" : "Файлы загружены";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const scrollToScripts = useCallback(() => {
    requestAnimationFrame(() => {
      scriptsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const validateFiles = useCallback((picked: File[]) => {
    if (!picked.length) return "Файл не выбран";
    const bad = picked.find((f) => {
      const n = f.name.toLowerCase();
      return !(n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls"));
    });
    if (bad) return `Файл "${bad.name}" не поддерживается. Разрешены CSV и Excel (XLSX/XLS).`;

    const total = picked.reduce((s, f) => s + f.size, 0);
    const maxTotal = 200 * 1024 * 1024; // 200MB
    if (total > maxTotal)
      return `Слишком большой объём (${(total / 1024 / 1024).toFixed(1)} MB). Максимум ${maxTotal / 1024 / 1024} MB.`;

    return null;
  }, []);

  const handlePicked = useCallback(
    (picked: File[]) => {
      setError(null);
      setRunError(null);

      const err = validateFiles(picked);
      if (err) {
        setError(err);
        setFiles([]);
        return;
      }

      setFiles(picked);
      scrollToScripts();
    },
    [scrollToScripts, validateFiles]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const refreshScripts = useCallback(async () => {
    try {
      setScriptsLoading(true);
      setScriptsError(null);
      const res = await fetch("/api/scripts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { scripts?: ScriptMeta[] };
      const list = Array.isArray(data.scripts) ? data.scripts : [];
      if (!mountedRef.current) return;
      setScripts(list);
      if (!selectedScriptId && list.length) setSelectedScriptId(list[0].id);
    } catch {
      if (!mountedRef.current) return;
      setScripts([]);
      setScriptsError("Не удалось загрузить список скриптов (/api/scripts).");
    } finally {
      if (mountedRef.current) setScriptsLoading(false);
    }
  }, [selectedScriptId]);

  useEffect(() => {
    refreshScripts();
  }, [refreshScripts]);

  const runSelected = useCallback(async (scriptId?: string) => {
    setRunError(null);

    if (!files.length) {
      setRunError("Сначала загрузите файл с данными.");
      scrollToScripts();
      return;
    }
    const targetScriptId = scriptId || selectedScriptId;
    if (!targetScriptId) {
      setRunError("Выберите скрипт.");
      return;
    }

    setIsRunning(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      fd.append("scriptId", targetScriptId);

      const res = await fetch("/api/run", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const ct = res.headers.get("content-type") || "application/octet-stream";

      const fallbackName =
        ct.includes("zip") ? `${targetScriptId}.zip` : `${targetScriptId}.xlsx`;
      const filename = cd?.match(/filename\*?=(?:UTF-8''|")?([^;"\n]+)"?/i)?.[1] || fallbackName;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setRunError("Скрипт не соответствует входным данным или это не подходящий скрипт для этих данных.");
    } finally {
      setIsRunning(false);
    }
  }, [files, scrollToScripts, selectedScriptId]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        {/* DROPZONE */}
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setIsDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current = 0;
            setIsDragging(false);
            const picked = Array.from(e.dataTransfer.files || []);
            if (!picked.length) return;
            handlePicked(picked);
          }}
          className={[
            "relative rounded-3xl border bg-white shadow-sm p-8 sm:p-10 min-h-[260px] sm:min-h-[300px] transition-all duration-200 ring-offset-2 ring-offset-white",
            isDragging ? "border-emerald-300 ring-4 ring-emerald-100" : "border-slate-200 hover:border-slate-300",
          ].join(" ")}
        >
          <div className="flex h-full flex-col gap-6 sm:gap-8">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M7 9l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">Зона загрузки</div>
                  <div className="text-sm text-slate-600">CSV / XLSX / XLS • перетаскивание или выбор файла</div>
                </div>
              </div>
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                {files.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Выбрано: <span className="font-medium text-slate-900">{files.map(f => f.name).join(", ")}</span></span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      {uploadStatus}
                    </span>
                  </div>
                ) : "Файл не выбран"}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onPickClick}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800 active:bg-slate-900"
                >
                  Загрузить файл(ы)
                </button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  if (!picked.length) return;
                  handlePicked(picked);
                }}
              />
            </div>
          </div>
        </div>

        {/* SCRIPTS SECTION */}
        {hasFiles && (
          <div ref={scriptsRef} className="mt-12">
            <h2 className="text-2xl font-semibold text-slate-900">Отчеты</h2>
            <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              {runError && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{runError}</div>
              )}
              {isRunning && (
                <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  Выполняется. Это может занять немного времени.
                </div>
              )}
              {scriptsLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Загрузка списка скриптов...</div>
              ) : scriptsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{scriptsError}</div>
              ) : scripts.length === 0 ? (
                <div className="text-sm text-slate-600">Скрипты не найдены.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {scripts.map((s) => {
                    const active = s.id === selectedScriptId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isRunning}
                        onClick={() => setSelectedScriptId(s.id)}
                        onDoubleClick={() => { setSelectedScriptId(s.id); runSelected(s.id); }}
                        className={["w-full rounded-2xl border px-4 py-3 text-left transition", active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50", isRunning ? "cursor-not-allowed opacity-70" : ""].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{s.title?.trim() || s.id}</div>
                          {s.version && <div className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">v{s.version}</div>}
                        </div>
                        {s.description && <div className="mt-1 text-xs text-slate-600 line-clamp-2">{s.description}</div>}
                        <div className="mt-2 text-xs text-slate-500">id: <span className="font-mono">{s.id}</span></div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="h-14" />
      </div>
    </main>
  );
}