"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ScriptMeta = {
  id: string;
  title?: string;
  version?: string;
  description?: string;
};

function formatBytes(n: number) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function guessDownloadName(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  // Content-Disposition: attachment; filename="report.xlsx"
  const m = /filename\*?=(?:UTF-8''|")?([^;"\n]+)"?/i.exec(contentDisposition);
  if (!m?.[1]) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export default function HomePage() {
  const dragDepth = useRef(0);
  const scriptsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");

  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const accept = ".csv,.xlsx,.xls";

  const hasFiles = files.length > 0;

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
      return `Слишком большой объём (${formatBytes(total)}). Максимум ${formatBytes(maxTotal)}.`;

    return null;
  }, []);

  const scrollToScripts = useCallback(() => {
    // чуть задержки, чтобы секция уже отрендерилась
    requestAnimationFrame(() => {
      scriptsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // грузим список скриптов
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setScriptsError(null);
        const res = await fetch("/api/scripts", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { scripts?: ScriptMeta[] };
        const list = Array.isArray(data.scripts) ? data.scripts : [];
        if (cancelled) return;
        setScripts(list);

        // авто-выбор первого
        if (!selectedScriptId && list.length) {
          setSelectedScriptId(list[0].id);
        }
      } catch (e: any) {
        if (cancelled) return;
        setScripts([]);
        setScriptsError("Не удалось загрузить список скриптов (/api/scripts).");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedScript = useMemo(() => {
    return scripts.find((s) => s.id === selectedScriptId) || null;
  }, [scripts, selectedScriptId]);

  const runSelected = useCallback(async () => {
    setRunError(null);

    if (!files.length) {
      setRunError("Сначала загрузите файл с данными.");
      scrollToScripts();
      return;
    }
    if (!selectedScriptId) {
      setRunError("Выберите скрипт.");
      return;
    }

    setIsRunning(true);
    try {
      const fd = new FormData();
      // Передаём сырой файл(ы). Позже можно будет передавать распарсенный dataset, но для MVP проще так.
      for (const f of files) fd.append("files", f);
      fd.append("scriptId", selectedScriptId);

      const res = await fetch("/api/run", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const ct = res.headers.get("content-type") || "application/octet-stream";

      const fallbackName =
        ct.includes("zip") ? `${selectedScriptId}.zip` : `${selectedScriptId}.xlsx`;
      const filename = guessDownloadName(cd, fallbackName);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setRunError(e?.message || "Ошибка выполнения");
    } finally {
      setIsRunning(false);
    }
  }, [files, scrollToScripts, selectedScriptId]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <header className="mb-6 flex flex-col gap-4">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Загрузите данные
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Перетащите CSV/XLSX в большую зону или выберите файл вручную. После загрузки ниже
            появится список скриптов. Вы выбираете отчёт — получаете файл.
          </p>
        </header>

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
            "relative rounded-3xl border bg-white shadow-sm",
            "p-8 sm:p-10",
            "min-h-[340px] sm:min-h-[420px]",
            "transition-all duration-200",
            "ring-offset-2 ring-offset-white",
            isDragging
              ? "border-emerald-300 ring-4 ring-emerald-100"
              : "border-slate-200 hover:border-slate-300",
          ].join(" ")}
        >
          <div className="flex h-full flex-col justify-between gap-8">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 16V4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7 9l5-5 5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M4 20h16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div>
                  <div className="text-lg font-semibold text-slate-900">Большая зона загрузки</div>
                  <div className="text-sm text-slate-600">
                    CSV / XLSX / XLS • перетаскивание или выбор файла
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6">
                <div className="text-sm text-slate-700">
                  Перетащите файл сюда
                  <span className="text-slate-500"> — или нажмите кнопку ниже.</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  После загрузки страница промотается к списку скриптов.
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
                  <span>
                    Выбрано:{" "}
                    <span className="font-medium text-slate-900">
                      {files.map((f) => f.name).join(", ")}
                    </span>
                  </span>
                ) : (
                  <span>Файл не выбран</span>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onPickClick}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800 active:bg-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
                >
                  Загрузить файл(ы)
                </button>

                {hasFiles && (
                  <button
                    type="button"
                    onClick={scrollToScripts}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Перейти к скриптам
                  </button>
                )}
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
        <div ref={scriptsRef} className="mt-12">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold text-slate-900">Скрипты</h2>
            <p className="text-sm text-slate-600">
              Выберите отчёт и нажмите “Выполнить”. Результат будет скачан.
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* scripts list */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              {scriptsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {scriptsError}
                </div>
              ) : scripts.length === 0 ? (
                <div className="text-sm text-slate-600">
                  Скрипты не найдены. Добавьте папки в <span className="font-mono">/scripts</span>{" "}
                  и реализуйте <span className="font-mono">/api/scripts</span>.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {scripts.map((s) => {
                    const active = s.id === selectedScriptId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedScriptId(s.id)}
                        className={[
                          "w-full rounded-2xl border px-4 py-3 text-left transition",
                          active
                            ? "border-slate-900 bg-slate-50"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {s.title?.trim() || s.id}
                          </div>
                          {s.version && (
                            <div className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                              v{s.version}
                            </div>
                          )}
                        </div>
                        {s.description && (
                          <div className="mt-1 text-xs text-slate-600 line-clamp-2">
                            {s.description}
                          </div>
                        )}
                        <div className="mt-2 text-xs text-slate-500">
                          id: <span className="font-mono">{s.id}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* run panel */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Запуск</div>

              <div className="mt-4 text-sm text-slate-600">
                <div>
                  Данные:{" "}
                  <span className="font-medium text-slate-900">
                    {files.length ? `${files.length} файл` : "не загружены"}
                  </span>
                </div>
                <div className="mt-1">
                  Скрипт:{" "}
                  <span className="font-medium text-slate-900">
                    {selectedScript ? selectedScript.title || selectedScript.id : "не выбран"}
                  </span>
                </div>
              </div>

              {runError && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {runError}
                </div>
              )}

              <button
                type="button"
                disabled={!hasFiles || !selectedScriptId || isRunning}
                onClick={runSelected}
                className={[
                  "mt-5 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium shadow-sm",
                  !hasFiles || !selectedScriptId || isRunning
                    ? "cursor-not-allowed bg-slate-100 text-slate-400"
                    : "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-900",
                ].join(" ")}
              >
                {isRunning ? "Выполнение…" : "Выполнить и скачать"}
              </button>

              <div className="mt-4 text-xs text-slate-500">
                Сейчас /api/run может быть заглушкой. Потом заменишь на реальный запуск Python.
              </div>
            </div>
          </div>
        </div>

        <div className="h-14" />
      </div>
    </main>
  );
}
