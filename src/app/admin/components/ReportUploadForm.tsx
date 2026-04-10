"use client";

import { DragEvent, useCallback, useRef, useState } from "react";
import AppSelect from "@/app/components/AppSelect";
import { useToastSync } from "@/app/components/AppToastProvider";

type ResultKind = "single" | "multiple";

type ReportUploadFormProps = {
  onUploaded?: (reportId: string) => void | Promise<void>;
};

export default function ReportUploadForm({ onUploaded }: ReportUploadFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resultKind, setResultKind] = useState<ResultKind>("single");
  const [script, setScript] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  useToastSync({
    error,
    clearError: () => setError(null),
    message: success,
    clearMessage: () => setSuccess(null),
  });

  const setPickedScript = useCallback((picked: File | null) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".py")) {
      setError("Нужен Python-скрипт с расширением .py.");
      setSuccess(null);
      return;
    }
    setScript(picked);
    setError(null);
    setSuccess(null);
  }, []);

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const uploadReport = useCallback(
    async (overwrite: boolean) => {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("resultKind", resultKind);
      if (overwrite) fd.append("overwrite", "1");
      fd.append("script", script as File, (script as File).name);

      const res = await fetch("/api/reports/upload", { method: "POST", body: fd });

      let data: { error?: string; reportId?: string } | null = null;
      try {
        data = (await res.json()) as { error?: string; reportId?: string };
      } catch {
        data = null;
      }

      return { res, data };
    },
    [description, resultKind, script, title]
  );

  const submit = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!script) return setError("Выберите Python-скрипт отчета.");
    if (!title.trim()) return setError("Укажите название отчета.");

    setLoading(true);
    try {
      let { res, data } = await uploadReport(false);

      if (res.status === 409) {
        const shouldOverwrite = window.confirm(
          data?.reportId
            ? `Отчет с ID "${data.reportId}" уже существует. Перезаписать его?`
            : "Отчет с таким ID уже существует. Перезаписать его?"
        );

        if (!shouldOverwrite) {
          setError("Загрузка отменена: отчет с таким ID уже существует.");
          return;
        }

        ({ res, data } = await uploadReport(true));
      }

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        if (data?.error) msg = String(data.error);
        throw new Error(msg);
      }

      const uploadedReportId = data?.reportId || "";
      setSuccess(
        uploadedReportId ? `Отчет загружен. ID: ${uploadedReportId}` : "Отчет загружен."
      );

      if (uploadedReportId && onUploaded) {
        await onUploaded(uploadedReportId);
      }

      setTitle("");
      setDescription("");
      setResultKind("single");
      setScript(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить отчет.");
    } finally {
      setLoading(false);
    }
  }, [onUploaded, script, title, uploadReport]);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      const [picked] = Array.from(e.dataTransfer.files || []);
      setPickedScript(picked ?? null);
    },
    [setPickedScript]
  );

  return (
    <div className="w-full rounded-3xl border border-slate-200 bg-linear-to-b from-slate-50/90 to-white/70 p-6 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">Загрузка отчета</h2>
        <p className="mt-2 text-sm text-slate-600">
          Укажите метаданные отчета и загрузите один Python-скрипт `report.py`. ID будет
          создан автоматически из названия.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Название отчета</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Отчет по наличным"
            className="block w-full rounded-2xl border border-slate-300 bg-white/70 px-4 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Короткое описание логики отчета"
            className="block w-full rounded-2xl border border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Результат</label>
          <AppSelect
            value={resultKind}
            onChange={(e) => setResultKind(e.target.value as ResultKind)}
            wrapperClassName="block w-full rounded-2xl border border-slate-300 bg-white/70 shadow-sm"
            selectClassName="px-4 py-2 pr-9 text-sm text-slate-900"
            iconClassName="right-3 text-slate-500"
          >
            <option value="single">Один файл</option>
            <option value="multiple">Несколько файлов</option>
          </AppSelect>
          <p className="text-xs text-slate-500">
            Если отчет формирует несколько файлов, система отдаст их одним архивом.
          </p>
        </div>

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) setIsDragging(false);
          }}
          onDrop={onDrop}
          className={`rounded-2xl border border-dashed p-4 transition-colors sm:p-5 ${
            isDragging ? "border-emerald-400 bg-emerald-50/70" : "border-slate-300 bg-white/60"
          }`}
        >
          <div className="text-center text-sm text-slate-600">
            Скрипт: <span className="font-medium text-slate-900">{script ? script.name : "не выбран"}</span>
          </div>

          <p className="mt-2 text-center text-xs text-slate-500">
            Перетащите один файл `.py` сюда или выберите его через кнопку
          </p>

          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={onPickClick}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Выбрать скрипт
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".py"
              className="hidden"
              onChange={(e) => {
                const [picked] = Array.from(e.target.files || []);
                setPickedScript(picked ?? null);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="rounded-2xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Загрузка..." : "Загрузить"}
        </button>
      </div>
    </div>
  );
}