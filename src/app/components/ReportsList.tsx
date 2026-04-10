"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToastSync } from "@/app/components/AppToastProvider";
import { REPORT_RUN_STORAGE_KEY } from "@/app/components/report-run-storage";

export type ReportMeta = {
  id: string;
  title?: string;
  version?: string;
  description?: string;
};

type ReportRunStatus = "queued" | "running" | "done" | "failed" | "canceled";

type ReportRunMeta = {
  id: string;
  reportId: string;
  reportTitle: string | null;
  inputName: string;
  status: ReportRunStatus;
  outputName: string | null;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  canCancel: boolean;
  canDownload: boolean;
};

type ReportsListProps = {
  files: File[];
  onRequestStartOver?: () => void;
  onRunBusyChange?: (isBusy: boolean) => void;
  allowStartOver?: boolean;
};

function parseDownloadFilename(contentDisposition: string, fallback: string) {
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  const plainMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return plainMatch?.[1] || fallback;
}

function isBusyStatus(status: ReportRunStatus) {
  return status === "queued" || status === "running";
}

export default function ReportsList({
  files,
  onRequestStartOver,
  onRunBusyChange,
  allowStartOver = true,
}: ReportsListProps) {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [startingReportId, setStartingReportId] = useState<string | null>(null);
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ReportRunMeta | null>(null);
  const mountedRef = useRef(true);
  const autoDownloadRunIdRef = useRef<string | null>(null);
  const downloadedRunIdsRef = useRef<Set<string>>(new Set());

  useToastSync({
    error: runError,
    clearError: () => setRunError(null),
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const fetchReports = async () => {
      setReportsLoading(true);
      setReportsError(null);
      try {
        const res = await fetch("/api/reports", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { reports?: ReportMeta[] };
        const list = Array.isArray(data.reports) ? data.reports : [];
        if (!mountedRef.current) return;
        setReports(list);
        setSelectedReportId((current) => {
          if (current && list.some((report) => report.id === current)) return current;
          return list[0]?.id || "";
        });
      } catch {
        if (!mountedRef.current) return;
        setReportsError("Не удалось загрузить список отчетов.");
      } finally {
        if (mountedRef.current) setReportsLoading(false);
      }
    };

    fetchReports();
  }, []);

  useEffect(() => {
    const storedRunId = window.localStorage.getItem(REPORT_RUN_STORAGE_KEY);
    if (storedRunId) {
      setActiveRunId(storedRunId);
      autoDownloadRunIdRef.current = storedRunId;
    }
  }, []);

  const clearRememberedRun = () => {
    window.localStorage.removeItem(REPORT_RUN_STORAGE_KEY);
    setActiveRunId(null);
    setActiveRun(null);
    autoDownloadRunIdRef.current = null;
  };

  const downloadRunResult = async (runId: string, fallbackName: string) => {
    const res = await fetch(`/api/report-runs/${runId}/download`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const filename = parseDownloadFilename(
      res.headers.get("content-disposition") || "",
      fallbackName
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!activeRunId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadRun = async () => {
      try {
        const res = await fetch(`/api/report-runs/${activeRunId}`, { cache: "no-store" });

        if (res.status === 404) {
          if (cancelled) return;
          clearRememberedRun();
          if (!files.length) onRequestStartOver?.();
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as { run?: ReportRunMeta };
        const nextRun = data.run || null;
        if (cancelled || !mountedRef.current) return;

        setActiveRun(nextRun);

        if (!nextRun) {
          clearRememberedRun();
          if (!files.length) onRequestStartOver?.();
          return;
        }

        if (!isBusyStatus(nextRun.status) && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }

        if (
          nextRun.status === "done" &&
          autoDownloadRunIdRef.current === nextRun.id &&
          !downloadedRunIdsRef.current.has(nextRun.id)
        ) {
          try {
            await downloadRunResult(nextRun.id, nextRun.outputName || `${nextRun.reportId}.xlsx`);
            downloadedRunIdsRef.current.add(nextRun.id);
            clearRememberedRun();
          } catch {
            downloadedRunIdsRef.current.add(nextRun.id);
            autoDownloadRunIdRef.current = null;
            setRunError("Отчет сформирован, но файл не удалось скачать автоматически.");
          }
        }
      } catch {
        if (!cancelled && mountedRef.current) {
          setRunError("Не удалось обновить состояние отчета.");
        }
      }
    };

    void loadRun();
    intervalId = setInterval(() => {
      void loadRun();
    }, 2000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeRunId, files.length, onRequestStartOver]);

  const isRunBusy = isBusyStatus(activeRun?.status || "done");
  const showRunStateCard =
    !!activeRun &&
    !isRunBusy &&
    (activeRun.status === "failed" ||
      activeRun.status === "canceled" ||
      (activeRun.status === "done" && autoDownloadRunIdRef.current !== activeRun.id));

  useEffect(() => {
    onRunBusyChange?.(isRunBusy);
  }, [isRunBusy, onRunBusyChange]);

  const startRun = async (targetReportId: string) => {
    if (!files.length) {
      setRunError("Сначала загрузите файл с данными.");
      return;
    }
    if (!targetReportId) {
      setRunError("Выберите отчет.");
      return;
    }

    setIsStartingRun(true);
    setStartingReportId(targetReportId);
    setRunError(null);
    setSelectedReportId(targetReportId);

    try {
      const fd = new FormData();
      files.forEach((file) => fd.append("files", file));
      fd.append("reportId", targetReportId);

      const res = await fetch("/api/report-runs", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { run?: ReportRunMeta; error?: string } | null;

      if (!res.ok || !data?.run) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      autoDownloadRunIdRef.current = data.run.id;
      window.localStorage.setItem(REPORT_RUN_STORAGE_KEY, data.run.id);
      setActiveRunId(data.run.id);
      setActiveRun(data.run);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Не удалось запустить отчет.");
    } finally {
      setIsStartingRun(false);
      setStartingReportId(null);
    }
  };

  const cancelCurrentRun = async () => {
    if (!activeRunId || !activeRun?.canCancel) return;

    setIsCancellingRun(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/report-runs/${activeRunId}/cancel`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as { run?: ReportRunMeta; error?: string } | null;
      if (!res.ok || !data?.run) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      autoDownloadRunIdRef.current = null;
      setActiveRun(data.run);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Не удалось отменить выполнение отчета.");
    } finally {
      setIsCancellingRun(false);
    }
  };

  const dismissRunState = () => {
    clearRememberedRun();
    if (!files.length) {
      onRequestStartOver?.();
    }
  };

  const runStatusTitle = useMemo(() => {
    switch (activeRun?.status) {
      case "queued":
      case "running":
        return "Отчет выполняется";
      case "done":
        return "Отчет готов";
      case "failed":
        return "Ошибка выполнения";
      case "canceled":
        return "Выполнение отменено";
      default:
        return "";
    }
  }, [activeRun?.status]);

  return (
    <div className="mt-12">
      {files.length > 0 && (
        <div className="mx-auto mb-4 max-w-3xl rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 text-sm text-slate-700 shadow-sm">
          <div className="mb-2 text-sm font-medium">Файлы для обработки</div>
          <div className="space-y-2">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <Image
                    src="/xlsx-file.png"
                    alt="file"
                    width={26}
                    height={26}
                    className="opacity-80"
                  />
                  <span>{file.name}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => onRequestStartOver?.()}
              disabled={!allowStartOver}
              className="rounded-2xl bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Загрузить новый файл
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl"><h2 className="mb-4 text-2xl font-semibold text-slate-900">Отчеты</h2>
      <div className="relative mt-6 overflow-hidden rounded-3xl border bg-white/70 p-6 shadow-sm">
        {showRunStateCard && activeRun && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white/85 px-4 py-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">{runStatusTitle}</div>
                <div className="mt-1 text-sm text-slate-700">
                  {activeRun.reportTitle || activeRun.reportId}
                </div>
                <div className="mt-1 text-xs text-slate-500">Файл: {activeRun.inputName}</div>
                {activeRun.errorText && (
                  <div className="mt-2 max-w-2xl text-xs text-rose-600">{activeRun.errorText}</div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeRun.canDownload && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadRunResult(
                        activeRun.id,
                        activeRun.outputName || `${activeRun.reportId}.xlsx`
                      ).catch(() => setRunError("Не удалось скачать результат отчета."))
                    }
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
                  >
                    Скачать результат
                  </button>
                )}
                {activeRun.canCancel && (
                  <button
                    type="button"
                    onClick={cancelCurrentRun}
                    disabled={isCancellingRun}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCancellingRun ? "Отмена..." : "Отменить"}
                  </button>
                )}
                {!activeRun.canCancel && (
                  <button
                    type="button"
                    onClick={dismissRunState}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Скрыть
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {isRunBusy && (
          <>
            <div className="absolute inset-0 z-10 rounded-3xl bg-white/45 backdrop-blur-md" />
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <div className="flex min-w-[320px] items-center gap-4 rounded-2xl border border-slate-200 bg-white/92 px-5 py-4 shadow-xl">
                <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Формируем отчет</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {activeRun?.reportTitle || activeRun?.reportId || "Подготовка файла..."}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Можно перейти на другую страницу. Выполнение не сбросится.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {reportsLoading ? (
          <div className="text-sm text-slate-600">Загрузка списка отчетов...</div>
        ) : reportsError ? (
          <div className="text-sm text-rose-700">{reportsError}</div>
        ) : reports.length === 0 ? (
          <div className="text-sm text-slate-600">Отчеты не найдены.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((report) => {
              const active = report.id === selectedReportId;
              return (
                <div
                  key={report.id}
                  role="button"
                  tabIndex={isRunBusy ? -1 : 0}
                  aria-disabled={isRunBusy}
                  onClick={() => {
                    if (!isRunBusy) setSelectedReportId(report.id);
                  }}
                  onKeyDown={(event) => {
                    if (isRunBusy) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedReportId(report.id);
                    }
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 ${
                    active
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 bg-white/50 hover:bg-slate-50"
                  } ${isRunBusy ? "cursor-default" : "cursor-pointer"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{report.title || report.id}</span>
                      {report.description && (
                        <div className="mt-1 text-xs text-slate-600">{report.description}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {report.version && (
                        <span className="text-xs text-slate-500">v{report.version}</span>
                      )}
                      <button
                        type="button"
                        disabled={isStartingRun || isRunBusy || !files.length}
                        onClick={(event) => {
                          event.stopPropagation();
                          void startRun(report.id);
                        }}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isStartingRun && startingReportId === report.id ? "Запуск..." : "Запустить"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
