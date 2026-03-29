"use client";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";

export type ScriptMeta = { id: string; title?: string; version?: string; description?: string; };

type ScriptsListProps = {
  files: File[];
};

export default function ScriptsList({ files }: ScriptsListProps) {
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }}, []);

  useEffect(() => {
    const fetchScripts = async () => {
      setScriptsLoading(true);
      setScriptsError(null);
      try {
        const res = await fetch("/api/scripts", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { scripts?: ScriptMeta[] };
        const list = Array.isArray(data.scripts) ? data.scripts : [];
        if (!mountedRef.current) return;
        setScripts(list);
        if (!selectedScriptId && list.length) setSelectedScriptId(list[0].id);
      } catch {
        if (!mountedRef.current) return;
        setScriptsError("Не удалось загрузить скрипты.");
      } finally {
        if (mountedRef.current) setScriptsLoading(false);
      }
    };
    fetchScripts();
  }, [selectedScriptId]);

  const runSelected = async (scriptId?: string) => {
    if (!files.length) return setRunError("Сначала загрузите файл с данными.");
    const target = scriptId || selectedScriptId;
    if (!target) return setRunError("Выберите скрипт.");
    setIsRunning(true);
    setRunError(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      fd.append("scriptId", target);
      const res = await fetch("/api/run", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = `${target}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch {
      setRunError("Ошибка выполнения скрипта.");
    } finally { setIsRunning(false); }
  };

  return (
    <div className="mt-12">
      {files.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
          <div className="font-medium mb-1">Файлы для обработки:</div>
          {files.map((f, idx) => (
            <div key={idx} className="flex item-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <Image
                  src="/xlsx-file.png"
                  alt="file"
                  width={20}
                  height={20}
                  className="opacity-80"
                />
                <span>{f.name}</span>
                <span className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-2xl font-semibold text-slate-900 mb-4">Отчёты</h2>
      <div className="mt-6 rounded-3xl border bg-white/70 p-6 shadow-sm">
        {runError && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{runError}</div>}
        {isRunning && <div className="mb-4 text-sm text-slate-700">Выполняется...</div>}
        {scriptsLoading ? (
          <div className="text-sm text-slate-600">Загрузка списка скриптов...</div>
        ) : scriptsError ? (
          <div className="text-sm text-rose-700">{scriptsError}</div>
        ) : scripts.length === 0 ? (
          <div className="text-sm text-slate-600">Скрипты не найдены.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {scripts.map(s => {
              const active = s.id === selectedScriptId;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setSelectedScriptId(s.id)}
                  onDoubleClick={() => runSelected(s.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white/50 hover:bg-slate-50"}`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{s.title || s.id}</span>
                    {s.version && <span className="text-xs text-slate-500 ml-2">v{s.version}</span>}
                  </div>
                  {s.description && <div className="text-xs text-slate-600 mt-1">{s.description}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}