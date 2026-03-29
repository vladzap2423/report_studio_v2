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

  const validateFiles = useCallback((picked: File[]) => {
    if (!picked.length) return "Файл не выбран";
    const bad = picked.find(f => ![".csv", ".xlsx", ".xls"].some(ext => f.name.toLowerCase().endsWith(ext)));
    if (bad) return `Файл "${bad.name}" не поддерживается. Разрешены CSV и Excel (XLSX/XLS).`;

    const total = picked.reduce((s, f) => s + f.size, 0);
    if (total > 200 * 1024 * 1024) return "Слишком большой объём. Максимум 200MB.";
    return null;
  }, []);

  const handlePicked = useCallback((picked: File[]) => {
    const err = validateFiles(picked);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
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
    <div
      onDragEnter={e => { e.preventDefault(); dragDepth.current += 1; setIsDragging(true); }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setIsDragging(false); }}
      onDrop={onDrop}
      className={`relative rounded-3xl border p-8 min-h-[260px] transition-all ${isDragging ? "border-emerald-300 ring-4 ring-emerald-100" : "border-slate-200"}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M7 9l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900">Зона загрузки</div>
            <div className="text-sm text-slate-600">CSV / XLSX / XLS • перетаскивание или выбор файла</div>
          </div>
        </div>
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        <button type="button" onClick={onPickClick} className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-white">
          Загрузить файл(ы)
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
    </div>
  );
}