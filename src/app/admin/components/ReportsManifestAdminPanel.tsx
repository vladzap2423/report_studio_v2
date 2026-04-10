"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import AppSelect from "@/app/components/AppSelect";
import { useToastSync } from "@/app/components/AppToastProvider";
import ReportUploadForm from "./ReportUploadForm";

type ResultKind = "single" | "multiple";

type ReportItem = {
  id: string;
  title: string;
  version: string;
  description: string;
  resultKind: ResultKind;
};

function resultKindLabel(value: ResultKind) {
  return value === "multiple" ? "Несколько файлов" : "Один файл";
}

export default function ReportsManifestAdminPanel() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resultKind, setResultKind] = useState<ResultKind>("single");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedId) || null,
    [reports, selectedId]
  );

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/reports/admin", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; reports?: ReportItem[] }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось загрузить список отчетов.");
      }

      const nextReports = Array.isArray(data?.reports) ? data.reports : [];
      setReports(nextReports);
      setSelectedId((current) => {
        if (!nextReports.length) return null;
        if (current && nextReports.some((report) => report.id === current)) return current;
        return nextReports[0].id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить список отчетов.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!selectedReport) {
      setTitle("");
      setDescription("");
      setResultKind("single");
      return;
    }

    setTitle(selectedReport.title);
    setDescription(selectedReport.description || "");
    setResultKind(selectedReport.resultKind);
  }, [selectedReport]);

  const saveManifest = useCallback(async () => {
    if (!selectedReport) return;
    if (!title.trim()) {
      setError("Укажите название отчета.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/reports/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedReport.id,
          title: title.trim(),
          description: description.trim(),
          resultKind,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string; report?: ReportItem }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось сохранить manifest.");
      }

      if (data?.report) {
        setReports((current) =>
          current
            .map((report) => (report.id === data.report!.id ? data.report! : report))
            .sort((a, b) => a.title.localeCompare(b.title, "ru", { sensitivity: "base" }))
        );
        setSelectedId(data.report.id);
      }

      setMessage("Manifest обновлен.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить manifest.");
    } finally {
      setSaving(false);
    }
  }, [description, resultKind, selectedReport, title]);

  const handleUploaded = useCallback(
    async (reportId: string) => {
      await loadReports();
      setSelectedId(reportId);
      setIsUploadOpen(false);
    },
    [loadReports]
  );

  return (
    <>
      <div className="flex h-full min-h-0">
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/50">
          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Отчеты</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Просмотр и редактирование названия, описания и типа результата.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                aria-label="Добавить отчет"
                title="Добавить отчет"
              >
                +
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-sm text-slate-500">
                Загрузка отчетов...
              </div>
            ) : reports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-sm text-slate-500">
                В папке `reports` пока нет загруженных отчетов.
              </div>
            ) : (
              <div className="space-y-2">
                {reports.map((report) => {
                  const active = report.id === selectedId;
                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{report.title}</div>
                          <div
                            className={`mt-1 truncate text-xs ${
                              active ? "text-slate-300" : "text-slate-500"
                            }`}
                          >
                            {report.id}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${
                            active
                              ? "bg-white/10 text-white"
                              : "border border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {resultKindLabel(report.resultKind)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 flex-1 overflow-auto p-5">
          {!selectedReport ? (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-500">
              Выберите отчет слева, чтобы изменить его manifest.
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Manifest
                    </div>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">
                      {selectedReport.title}
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Версия: {selectedReport.version}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">ID отчета</label>
                    <input
                      type="text"
                      value={selectedReport.id}
                      readOnly
                      className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500 outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">Результат</label>
                    <AppSelect
                      value={resultKind}
                      onChange={(e) => setResultKind(e.target.value as ResultKind)}
                      wrapperClassName="block w-full rounded-2xl border border-slate-300 bg-white shadow-sm"
                      selectClassName="px-4 py-2 pr-9 text-sm text-slate-900"
                      iconClassName="right-3 text-slate-500"
                    >
                      <option value="single">Один файл</option>
                      <option value="multiple">Несколько файлов</option>
                    </AppSelect>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Название отчета</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
                  />
                </div>

                <div className="mt-4 space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Описание</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
                  />
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Имя скачиваемого файла берется из названия отчета в manifest.
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={saveManifest}
                    disabled={saving}
                    className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Сохранение..." : "Сохранить manifest"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {isUploadOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/25 backdrop-blur-sm">
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative w-full max-w-3xl">
                  <button
                    type="button"
                    onClick={() => setIsUploadOpen(false)}
                    className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-lg text-slate-600 shadow-sm transition-colors hover:bg-white"
                    aria-label="Закрыть"
                    title="Закрыть"
                  >
                    ×
                  </button>
                  <ReportUploadForm onUploaded={handleUploaded} />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}