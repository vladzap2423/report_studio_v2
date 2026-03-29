"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScriptMeta = {
  id: string;
  title?: string;
  version?: string;
  description?: string;
};

type ScriptsListProps = {
  files: File[];
  selectedScriptId: string;
  setSelectedScriptId: (id: string) => void;
  onRun: (id?: string) => void;
};

export default function ScriptsList({ files, selectedScriptId, setSelectedScriptId, onRun }: ScriptsListProps) {
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshScripts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scripts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { scripts?: ScriptMeta[] };
      const list = Array.isArray(data.scripts) ? data.scripts : [];
      if (!mountedRef.current) return;
      setScripts(list);
      if (!selectedScriptId && list.length) setSelectedScriptId(list[0].id);
    } catch {
      if (!mountedRef.current) return;
      setScripts([]);
      setError("Не удалось загрузить список скриптов (/api/scripts).");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedScriptId, setSelectedScriptId]);

  useEffect(() => {
    refreshScripts();
  }, [refreshScripts]);

  const handleRun = async (id?: string) => {
    setRunError(null);
    if (files.length === 0) {
      setRunError("Сначала загрузите файл с данными.");
      return;
    }
    setIsRunning(true);
    try {
      await onRun(id);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="mt-8">
      {files.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium">Файлы для обработки:</div>
          {files.map((f, idx) => (
            <div key={idx} className="flex justify-between mt-1">
              <span>{f.name}</span>
              <span className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-2xl font-semibold text-slate-900 mb-4">Скрипты</h2>

      {runError && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{runError}</div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Загрузка списка скриптов...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
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
                onDoubleClick={() => handleRun(s.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition
                  ${active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}
                  ${isRunning ? "cursor-not-allowed opacity-70" : ""}`}
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
  );
}