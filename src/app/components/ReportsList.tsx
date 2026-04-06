"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useToastSync } from "@/app/components/AppToastProvider";

export type ReportMeta = {
  id: string;
  title?: string;
  version?: string;
  description?: string;
};

type ReportsListProps = {
  files: File[];
};

export default function ReportsList({ files }: ReportsListProps) {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const mountedRef = useRef(true);

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
        if (!selectedReportId && list.length) setSelectedReportId(list[0].id);
      } catch {
        if (!mountedRef.current) return;
        setReportsError("Не удалось загрузить список отчетов.");
      } finally {
        if (mountedRef.current) setReportsLoading(false);
      }
    };

    fetchReports();
  }, []);

  const runSelected = async (reportId?: string) => {
    if (!files.length) return setRunError("Сначала загрузите файл с данными.");
    const target = reportId || selectedReportId;
    if (!target) return setRunError("Выберите отчет.");

    setIsRunning(true);
    setRunError(null);
    try {
      const fd = new FormData();
      files.forEach((file) => fd.append("files", file));
      fd.append("reportId", target);

      const res = await fetch("/api/reports/run", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename=\"([^\"]+)\"/i);
      const filename = match?.[1] || `${target}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setRunError("Ошибка выполнения отчета.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="mt-12">
      {files.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
          <div className="mb-1 font-medium">Файлы для обработки:</div>
          {files.map((file, index) => (
            <div key={index} className="mt-2 flex item-center justify-between">
              <div className="flex items-center gap-2">
                <Image
                  src="/xlsx-file.png"
                  alt="file"
                  width={20}
                  height={20}
                  className="opacity-80"
                />
                <span>{file.name}</span>
                <span className="text-xs text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-4 text-2xl font-semibold text-slate-900">Отчеты</h2>
      <div className="mt-6 rounded-3xl border bg-white/70 p-6 shadow-sm">

        {isRunning && <div className="mb-4 text-sm text-slate-700">Выполняется...</div>}
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
                <button
                  key={report.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setSelectedReportId(report.id)}
                  onDoubleClick={() => runSelected(report.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white/50 hover:bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{report.title || report.id}</span>
                    {report.version && (
                      <span className="ml-2 text-xs text-slate-500">v{report.version}</span>
                    )}
                  </div>
                  {report.description && (
                    <div className="mt-1 text-xs text-slate-600">{report.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

