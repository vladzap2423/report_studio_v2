"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";

type DocumentDropFieldProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  accept?: string;
};

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9 text-slate-400" aria-hidden="true">
      <path
        d="M7 3.75h6.75L18.25 8.25V19A1.75 1.75 0 0 1 16.5 20.75h-9A1.75 1.75 0 0 1 5.75 19v-13.5A1.75 1.75 0 0 1 7.5 3.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 3.75V8.5h4.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DocumentDropField({
  file,
  onFileChange,
  disabled = false,
  accept = ".pdf,.doc,.docx,.xls,.xlsx,.xml,.rtf,.txt,.odt",
}: DocumentDropFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const pickFile = (files: FileList | File[] | null | undefined) => {
    const nextFile = files && files.length > 0 ? files[0] : null;
    onFileChange(nextFile);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (disabled) return;
    pickFile(event.dataTransfer.files);
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled) return;
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        if (disabled) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setIsDragging(false);
      }}
      onDrop={onDrop}
      className={[
        "rounded-2xl border border-dashed p-4 transition",
        disabled
          ? "border-slate-200 bg-slate-50 opacity-70"
          : isDragging
            ? "border-emerald-400 bg-emerald-50/60"
            : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => pickFile(event.target.files)}
      />

      {file ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <DocumentIcon />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{file.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{formatFileSize(file.size)}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Заменить
            </button>
            <button
              type="button"
              onClick={() => onFileChange(null)}
              disabled={disabled}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Убрать
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-2 text-center">
          <DocumentIcon />
          <div>
            <div className="text-sm font-medium text-slate-800">Перетащите документ сюда</div>
            <div className="mt-1 text-xs text-slate-500">
              Один файл для подписания. Можно выбрать и через кнопку ниже.
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Выбрать документ
          </button>
        </div>
      )}
    </div>
  );
}
