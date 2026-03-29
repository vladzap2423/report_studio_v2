"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  const scriptInputRef = useRef<HTMLInputElement | null>(null);
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
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [instructionTitle, setInstructionTitle] = useState("");
  const [instructionContent, setInstructionContent] = useState<string | null>(null);
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [instructionLoading, setInstructionLoading] = useState(false);
  const [scriptUploadId, setScriptUploadId] = useState("");
  const [scriptUploadFiles, setScriptUploadFiles] = useState<File[]>([]);
  const [scriptUploadError, setScriptUploadError] = useState<string | null>(null);
  const [scriptUploadSuccess, setScriptUploadSuccess] = useState<string | null>(null);
  const [scriptUploadLoading, setScriptUploadLoading] = useState(false);
  const [scriptUploadOverwrite, setScriptUploadOverwrite] = useState(false);
  const [scriptUploadPassword, setScriptUploadPassword] = useState("");
  const [scriptPasswordOpen, setScriptPasswordOpen] = useState(false);
  const [scriptUploadModalOpen, setScriptUploadModalOpen] = useState(false);
  const [scriptUploadPasswordError, setScriptUploadPasswordError] = useState<string | null>(null);

  const accept = ".csv,.xlsx,.xls";

  const hasFiles = files.length > 0;
  const uploadStatus = files.length === 1 ? "Файл загружен" : "Файлы загружены";

  useEffect(() => {
    mountedRef.current = true;
    if (scriptInputRef.current) {
      (scriptInputRef.current as any).webkitdirectory = true;
      (scriptInputRef.current as any).directory = true;
    }
    return () => {
      mountedRef.current = false;
    };
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

  useEffect(() => {
    if (!instructionOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInstructionOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [instructionOpen]);

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onScriptPickClick = useCallback(() => {
    scriptInputRef.current?.click();
  }, []);

  const confirmScriptPassword = useCallback(() => {
    setScriptUploadPasswordError(null);
    if (scriptUploadPassword === "Zx44tfW") {
      setScriptPasswordOpen(false);
      setScriptUploadModalOpen(true);
      return;
    }
    setScriptUploadPasswordError("Неверный пароль.");
  }, [scriptUploadPassword]);

  const closeScriptPasswordModal = useCallback(() => {
    setScriptPasswordOpen(false);
    setScriptUploadPasswordError(null);
    setScriptUploadPassword("");
  }, []);

  const closeScriptUploadModal = useCallback(() => {
    setScriptUploadModalOpen(false);
    setScriptUploadError(null);
    setScriptUploadSuccess(null);
  }, []);

  const refreshScripts = useCallback(async () => {
    try {
      setScriptsLoading(true);
      setScriptsError(null);
      const res = await fetch("/api/scripts", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { scripts?: ScriptMeta[] };
      const list = Array.isArray(data.scripts) ? data.scripts : [];
      if (!mountedRef.current) return;
      setScripts(list);

      if (!selectedScriptId && list.length) {
        setSelectedScriptId(list[0].id);
      }
    } catch (e: any) {
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

  const handleScriptPicked = useCallback(
    (picked: File[]) => {
      setScriptUploadError(null);
      setScriptUploadSuccess(null);
      setScriptUploadFiles(picked);

      if (!scriptUploadId && picked.length) {
        const rel = (picked[0] as any).webkitRelativePath || "";
        const top = String(rel).split("/")[0];
        if (top) setScriptUploadId(top);
      }
    },
    [scriptUploadId]
  );

  const uploadScripts = useCallback(async () => {
    setScriptUploadError(null);
    setScriptUploadSuccess(null);

    if (!scriptUploadFiles.length) {
      setScriptUploadError("Выберите файлы скрипта.");
      return;
    }
    if (!scriptUploadId.trim()) {
      setScriptUploadError("Укажите id скрипта (имя папки).");
      return;
    }
    if (scriptUploadPassword !== "Zx44tfW") {
      setScriptUploadError("Неверный пароль для загрузки скрипта.");
      return;
    }

    setScriptUploadLoading(true);
    try {
      const fd = new FormData();
      fd.append("scriptId", scriptUploadId.trim());
      fd.append("password", scriptUploadPassword);
      if (scriptUploadOverwrite) fd.append("overwrite", "1");
      for (const f of scriptUploadFiles) {
        const rel = (f as any).webkitRelativePath || f.name;
        fd.append("files", f, rel);
      }

      const res = await fetch("/api/scripts/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      setScriptUploadSuccess("Скрипт загружен.");
      setScriptUploadFiles([]);
      if (scriptInputRef.current) scriptInputRef.current.value = "";
      setScriptUploadPassword("");
      await refreshScripts();
    } catch (e: any) {
      setScriptUploadError("Не удалось загрузить скрипт.");
    } finally {
      setScriptUploadLoading(false);
    }
  }, [refreshScripts, scriptUploadFiles, scriptUploadId, scriptUploadOverwrite]);

  const openInstruction = useCallback(async (script: ScriptMeta) => {
    setInstructionTitle(script.title?.trim() || script.id);
    setInstructionOpen(true);
    setInstructionLoading(true);
    setInstructionError(null);
    setInstructionContent(null);

    try {
      const res = await fetch(`/api/instruction?scriptId=${encodeURIComponent(script.id)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { content?: string };
      setInstructionContent(data.content || "");
    } catch (e: any) {
      setInstructionError("Инструкция не найдена.");
    } finally {
      setInstructionLoading(false);
    }
  }, []);

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
      // Передаём сырой файл(ы). Позже можно будет передавать распарсенный dataset, но для MVP проще так.
      for (const f of files) fd.append("files", f);
      fd.append("scriptId", targetScriptId);

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
        ct.includes("zip") ? `${targetScriptId}.zip` : `${targetScriptId}.xlsx`;
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
      setRunError(
        "Скрипт не соответствует входным данным или это не подходящий скрипт для этих данных."
      );
    } finally {
      setIsRunning(false);
    }
  }, [files, scrollToScripts, selectedScriptId]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            onClick={() => {
              setScriptUploadPasswordError(null);
              setScriptPasswordOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Загрузить скрипт
          </button>
          <Link
            href="/services"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Перейти к справочнику услуг
          </Link>
        </div>

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
            "min-h-[260px] sm:min-h-[300px]",
            "transition-all duration-200",
            "ring-offset-2 ring-offset-white",
            isDragging
              ? "border-emerald-300 ring-4 ring-emerald-100"
              : "border-slate-200 hover:border-slate-300",
          ].join(" ")}
        >
          <div className="flex h-full flex-col gap-6 sm:gap-8">
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
                  <div className="text-lg font-semibold text-slate-900">Зона загрузки</div>
                  <div className="text-sm text-slate-600">
                    CSV / XLSX / XLS • перетаскивание или выбор файла
                  </div>
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
                    <span>
                      Выбрано:{" "}
                      <span className="font-medium text-slate-900">
                        {files.map((f) => f.name).join(", ")}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 12l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {uploadStatus}
                    </span>
                  </div>
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
          <>
            <div ref={scriptsRef} className="mt-12">
              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold text-slate-900">Отчеты</h2>
              </div>

              <div className="mt-6">
                {/* scripts list */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  {runError && (
                    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {runError}
                    </div>
                  )}
                  {isRunning && (
                    <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                      Выполняется. Это может занять немного времени.
                    </div>
                  )}
                  {scriptsLoading ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Загрузка списка скриптов...
                    </div>
                  ) : scriptsError ? (
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
                            disabled={isRunning}
                            onClick={() => setSelectedScriptId(s.id)}
                            onDoubleClick={() => {
                              setSelectedScriptId(s.id);
                              runSelected(s.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (isRunning) return;
                              setSelectedScriptId(s.id);
                              const menuWidth = 220;
                              const menuHeight = 96;
                              const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
                              const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
                              setContextMenu({ x, y, script: s });
                            }}
                            className={[
                              "w-full rounded-2xl border px-4 py-3 text-left transition",
                              active
                                ? "border-slate-900 bg-slate-50"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                              isRunning ? "cursor-not-allowed opacity-70" : "",
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
              </div>
            </div>

            {contextMenu && (
              <div
                className="fixed z-50"
                style={{ top: contextMenu.y, left: contextMenu.x }}
              >
                <div className="w-[220px] rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      setContextMenu(null);
                      runSelected(contextMenu.script.id);
                    }}
                    className={[
                      "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm",
                      isRunning ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    Запустить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      openInstruction(contextMenu.script);
                    }}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Информация
                  </button>
                </div>
              </div>
            )}

            {instructionOpen && (
              <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6">
                <div
                  className="absolute inset-0 bg-slate-900/30"
                  onClick={() => setInstructionOpen(false)}
                />
                <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Инструкция</div>
                      <div className="mt-1 text-sm text-slate-600">{instructionTitle}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInstructionOpen(false)}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Закрыть
                    </button>
                  </div>

                  <div className="mt-4">
                    {instructionLoading ? (
                      <div className="text-sm text-slate-600">Загрузка инструкции...</div>
                    ) : instructionError ? (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {instructionError}
                      </div>
                    ) : instructionContent ? (
                      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                        {instructionContent}
                      </pre>
                    ) : (
                      <div className="text-sm text-slate-600">Инструкция пустая.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="h-14" />
          </>
        )}

      {scriptPasswordOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/30"
            onClick={closeScriptPasswordModal}
          />
          <div className="relative z-10 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Доступ к загрузке</div>
                <div className="mt-1 text-sm text-slate-600">Введите пароль</div>
              </div>
              <button
                type="button"
                onClick={closeScriptPasswordModal}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4">
              <input
                type="password"
                value={scriptUploadPassword}
                onChange={(e) => setScriptUploadPassword(e.target.value)}
                placeholder="Введите пароль"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
              />
            </div>

            {scriptUploadPasswordError && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {scriptUploadPasswordError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeScriptPasswordModal}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmScriptPassword}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
              >
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}

      {scriptUploadModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/30"
            onClick={closeScriptUploadModal}
          />
          <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Загрузка скрипта</div>
                <div className="mt-1 text-sm text-slate-600">report.py, manifest.json, instruction.txt ? ?.?.</div>
              </div>
              <button
                type="button"
                onClick={closeScriptUploadModal}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr] sm:items-center">
              <label className="text-sm font-medium text-slate-700">ID скрипта</label>
              <input
                type="text"
                value={scriptUploadId}
                onChange={(e) => setScriptUploadId(e.target.value)}
                placeholder="например: amb_nagruzka"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <div>
                Файлы:{" "}
                <span className="font-medium text-slate-900">
                  {scriptUploadFiles.length ? `${scriptUploadFiles.length} шт.` : "не выбраны"}
                </span>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={scriptUploadOverwrite}
                  onChange={(e) => setScriptUploadOverwrite(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                Перезаписать, если скрипт уже существует
              </label>
            </div>

            {scriptUploadError && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {scriptUploadError}
              </div>
            )}
            {scriptUploadSuccess && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {scriptUploadSuccess}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onScriptPickClick}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Выбрать файлы
              </button>
              <button
                type="button"
                disabled={scriptUploadLoading}
                onClick={uploadScripts}
                className={[
                  "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium shadow-sm",
                  scriptUploadLoading
                    ? "cursor-not-allowed bg-slate-100 text-slate-400"
                    : "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-900",
                ].join(" ")}
              >
                {scriptUploadLoading ? "Загрузка..." : "Загрузить"}
              </button>
            </div>

            <input
              ref={scriptInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (!picked.length) return;
                handleScriptPicked(picked);
              }}
            />
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
