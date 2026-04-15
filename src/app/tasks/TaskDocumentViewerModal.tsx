"use client";

import { useEffect, useMemo, useState } from "react";

type PreviewKind = "pdf" | "spreadsheet" | "text" | "unsupported";

type SpreadsheetPreview = {
  sheetName: string;
  rows: string[][];
};

type TaskDocumentViewerModalProps = {
  taskId: number;
  taskTitle: string;
  documentName: string;
  documentMimeType?: string | null;
  onClose: () => void;
};

function getExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function resolvePreviewKind(fileName: string, mimeType?: string | null): PreviewKind {
  const extension = getExtension(fileName);
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("pdf") || extension === "pdf") return "pdf";
  if (
    mime.includes("sheet") ||
    mime.includes("excel") ||
    extension === "xlsx" ||
    extension === "xls"
  ) {
    return "spreadsheet";
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("xml") ||
    extension === "txt" ||
    extension === "xml" ||
    extension === "rtf"
  ) {
    return "text";
  }
  return "unsupported";
}

export default function TaskDocumentViewerModal({
  taskId,
  taskTitle,
  documentName,
  documentMimeType,
  onClose,
}: TaskDocumentViewerModalProps) {
  const previewKind = useMemo(
    () => resolvePreviewKind(documentName, documentMimeType),
    [documentMimeType, documentName]
  );
  const isPdfPreview = previewKind === "pdf";
  const inlineUrl = useMemo(() => `/api/tasks/document?taskId=${taskId}&inline=1`, [taskId]);
  const downloadUrl = useMemo(() => `/api/tasks/document?taskId=${taskId}`, [taskId]);

  const [loadingPreview, setLoadingPreview] = useState(previewKind !== "pdf");
  const [previewError, setPreviewError] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<SpreadsheetPreview | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (previewKind === "pdf" || previewKind === "unsupported") {
      setLoadingPreview(false);
      setPreviewError("");
      setTextPreview("");
      setSpreadsheetPreview(null);
      return;
    }

    let cancelled = false;

    const loadPreview = async () => {
      setLoadingPreview(true);
      setPreviewError("");
      setTextPreview("");
      setSpreadsheetPreview(null);

      try {
        const response = await fetch(inlineUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (previewKind === "text") {
          const text = await response.text();
          if (!cancelled) {
            setTextPreview(text);
          }
          return;
        }

        if (previewKind === "spreadsheet") {
          const [{ read, utils }, arrayBuffer] = await Promise.all([
            import("xlsx"),
            response.arrayBuffer(),
          ]);
          const workbook = read(arrayBuffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            throw new Error("Empty workbook");
          }

          const worksheet = workbook.Sheets[firstSheetName];
          const rows = utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
            header: 1,
            raw: false,
            blankrows: false,
          });

          const normalizedRows = rows
            .slice(0, 60)
            .map((row) =>
              (row || []).slice(0, 12).map((cell) => (cell == null ? "" : String(cell)))
            );

          if (!cancelled) {
            setSpreadsheetPreview({
              sheetName: firstSheetName,
              rows: normalizedRows,
            });
          }
        }
      } catch (_error) {
        if (!cancelled) {
          setPreviewError("Не удалось подготовить предпросмотр документа.");
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [inlineUrl, previewKind]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        {!isPdfPreview && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <div className="text-base font-semibold text-slate-900">{taskTitle}</div>
              <div className="mt-1 truncate text-sm text-slate-500">{documentName}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <a
                href={downloadUrl}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                Скачать
              </a>
              <a
                href={inlineUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                Открыть отдельно
              </a>
            </div>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-slate-50">
          {isPdfPreview ? (
            <div className="relative h-full bg-[#4b4b4b]">
              <iframe
                src={inlineUrl}
                title={documentName}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          ) : loadingPreview ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Подготавливаем предпросмотр...
            </div>
          ) : previewError ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-rose-600">
              {previewError}
            </div>
          ) : previewKind === "text" ? (
            <div className="h-full overflow-auto bg-white p-5">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                {textPreview}
              </pre>
            </div>
          ) : previewKind === "spreadsheet" && spreadsheetPreview ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200 bg-white px-5 py-3 text-xs text-slate-500">
                Лист: {spreadsheetPreview.sheetName}. Показаны первые 60 строк и 12 столбцов.
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                <table className="min-w-full border-separate border-spacing-0 text-sm text-slate-700">
                  <tbody>
                    {spreadsheetPreview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="border border-slate-200 px-3 py-2 align-top"
                          >
                            {cell || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <div className="text-base font-semibold text-slate-900">
                  Предпросмотр для этого формата пока недоступен
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  Для DOC, DOCX и некоторых других форматов пока доступно только скачивание или
                  открытие файла отдельным приложением.
                </div>
                <div className="mt-4 flex justify-center gap-2">
                  <a
                    href={downloadUrl}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Скачать файл
                  </a>
                  <a
                    href={inlineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                  >
                    Открыть отдельно
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
