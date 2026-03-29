"use client";

import { DragEvent, useCallback, useRef, useState } from "react";

type UploadFile = {
  file: File;
  relativePath: string;
};

export default function ReportUploadPanel() {
  const [id, setId] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  const mapUploadFiles = useCallback((picked: File[]) => {
    return picked.map((file) => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }));
  }, []);

  const setPickedFiles = useCallback(
    (picked: File[]) => {
      if (!picked.length) return;
      setFiles(mapUploadFiles(picked));
      setError(null);
      setSuccess(null);
    },
    [mapUploadFiles]
  );

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const uploadReports = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!files.length) return setError("Выберите файлы отчета.");
    if (!id.trim()) return setError("Укажите ID отчета.");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("reportId", id.trim());
      if (overwrite) fd.append("overwrite", "1");
      for (const item of files) {
        fd.append("files", item.file, item.relativePath);
      }

      const res = await fetch("/api/reports/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }

      setSuccess("Отчет загружен.");
      setFiles([]);
      setId("");
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("Не удалось загрузить отчет.");
    } finally {
      setLoading(false);
    }
  }, [files, id, overwrite]);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      const picked = Array.from(e.dataTransfer.files || []);
      setPickedFiles(picked);
    },
    [setPickedFiles]
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center">
        <div className="w-full rounded-3xl border border-slate-200 bg-linear-to-b from-slate-50/90 to-white/70 p-6 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">Загрузка отчета</h2>
            <p className="mt-2 text-sm text-slate-600">
              Укажите ID, выберите файлы папки отчета и загрузите в систему
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="block text-center text-sm font-medium text-slate-700">
                ID отчета
              </label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="например: cash_report"
                className="mx-auto block w-full max-w-xl rounded-2xl border border-slate-300 bg-white/70 px-4 py-2 text-center text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
              />
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
                isDragging
                  ? "border-emerald-400 bg-emerald-50/70"
                  : "border-slate-300 bg-white/60"
              }`}
            >
              <div className="text-center text-sm text-slate-600">
                Файлы:{" "}
                <span className="font-medium text-slate-900">
                  {files.length ? `${files.length} шт.` : "не выбраны"}
                </span>
              </div>

              <p className="mt-2 text-center text-xs text-slate-500">
                Перетащите папку или файлы сюда, либо выберите через кнопку
              </p>

              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={onPickClick}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
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
                    setPickedFiles(picked);
                  }}
                  {...({ webkitdirectory: "true" } as any)}
                />
              </div>
            </div>

            <label
              htmlFor="overwrite"
              className="mx-auto flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                id="overwrite"
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
              />
              Перезаписать, если уже существует
            </label>
          </div>

          {error && (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={uploadReports}
              disabled={loading}
              className="rounded-2xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Загрузка..." : "Загрузить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
