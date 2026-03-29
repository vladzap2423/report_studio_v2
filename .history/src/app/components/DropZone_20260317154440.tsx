"use client";

import { useRef, useState, DragEvent, ChangeEvent, useCallback } from "react";

type DropZoneProps = {
  accept?: string;
  onFilesPicked: (files: File[]) => void;
};

export default function DropZone({ accept = ".csv,.xlsx,.xls", onFilesPicked }: DropZoneProps) {
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const validateFiles = useCallback((picked: File[]) => {
    if (!picked.length) return "Файл не выбран";
    const bad = picked.find(f => ![".csv", ".xlsx", ".xls"].some(ext => f.name.toLowerCase().endsWith(ext)));
    if (bad) return `Файл "${bad.name}" не поддерживается. Разрешены CSV / XLSX / XLS.`;

    const total = picked.reduce((s, f) => s + f.size, 0);
    if (total > 200 * 1024 * 1024) return "Слишком большой объём. Максимум 200MB.";
    return null;
  }, []);

  const handlePicked = useCallback((picked: File[]) => {
    const err = validateFiles(picked);
    if (err) {
      setError(err);
      setFiles([]);
      return;
    }
    setError(null);
    setFiles(picked);
    onFilesPicked(picked);
  }, [onFilesPicked, validateFiles]);

  const onPickClick = () => inputRef.current?.click();

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const picked = Array.from(e.dataTransfer.files || []);
    if (!picked.length) return;
    handlePicked(picked);
  };

  return (
    <div className="flex flex-col gap-6 py-50">
      <div
        onDragEnter={e => { e.preventDefault(); dragDepth.current += 1; setIsDragging(true); }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={e => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setIsDragging(false); }}
        onDrop={onDrop}
        className={`
    relative flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-12 transition-all duration-300
    ${isDragging ? "border-emerald-400 bg-white/20 shadow-lg" : "border-slate-300 bg-white/40 hover:border-slate-400 hover:shadow-md"}
  `}
      >
        <svg className="w-12 h-12 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12v-8m0 0L8 8m4-4l4 4" />
        </svg>
        <p className="text-lg font-semibold text-slate-900">Перетащите файлы сюда</p>
        <p className="text-sm text-slate-500">или выберите с компьютера (CSV / XLSX / XLS)</p>

        <button
          type="button"
          onClick={onPickClick}
          className="mt-3 rounded-full bg-slate-900 px-6 py-2 text-white text-sm font-medium hover:bg-slate-800 active:bg-slate-900"
        >
          Выбрать файл(ы)
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const picked = Array.from(e.target.files || []);
            if (!picked.length) return;
            handlePicked(picked);
          }}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-col gap-2 mt-4">
          {files.map((f, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
            >
              <span className="font-medium">{f.name}</span>
              <span className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}