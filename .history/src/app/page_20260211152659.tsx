"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PickedFile = {
  name: string;
  size: number;
  type: string;
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

export default function HomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dragDepth = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accept = ".csv,.xlsx,.xls";

  const persistAndGo = useCallback(
    (picked: File[]) => {
      const meta: PickedFile[] = picked.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      }));
      sessionStorage.setItem("pickedFilesMeta", JSON.stringify(meta));

      // MVP: сохраняем File-объекты в памяти вкладки (после F5 пропадут)
      (window as any).__PICKED_FILES__ = picked;

      router.push("/workspace");
    },
    [router]
  );

  const validateFiles = useCallback((picked: File[]) => {
    setError(null);
    if (!picked.length) return null;

    const bad = picked.find((f) => {
      const n = f.name.toLowerCase();
      return !(n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls"));
    });
    if (bad)
      return `Файл "${bad.name}" не поддерживается. Разрешены CSV и Excel (XLSX/XLS).`;

    const total = picked.reduce((s, f) => s + f.size, 0);
    const maxTotal = 200 * 1024 * 1024; // 200MB
    if (total > maxTotal)
      return `Слишком большой объём (${formatBytes(total)}). Максимум ${formatBytes(
        maxTotal
      )}.`;

    return null;
  }, []);

  const handlePicked = useCallback(
    (picked: File[]) => {
      const err = validateFiles(picked);
      if (err) {
        setError(err);
        setFiles([]);
        return;
      }
      setFiles(picked);
      persistAndGo(picked);
    },
    [persistAndGo, validateFiles]
  );

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <header className="mb-4 flex flex-col gap-4">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Загрузите данные!
          </h1>

          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Перетащите CSV/XLSX в большую зону или выберите файл вручную. Дальше вы
            сможете просматривать таблицу, редактировать и запускать один отчёт или группу.
          </p>
        </header>
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
            "p-0 sm:p-10",
            "min-h-[340px] sm:min-h-[420px]",
            "transition-all duration-200",
            "ring-offset-2 ring-offset-white",
            isDragging
              ? "border-emerald-300 ring-4 ring-emerald-100"
              : "border-slate-200 hover:border-slate-300",
          ].join(" ")}
        >
          <div className="flex h-full flex-col justify-between gap-8">
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
                  <div className="text-lg font-semibold text-slate-900">Большая зона загрузки</div>
                  <div className="text-sm text-slate-600">
                    CSV / XLSX / XLS • перетаскивание или выбор файла
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6">
                <div className="text-sm text-slate-700">
                  Перетащите файл сюда
                  <span className="text-slate-500"> — или нажмите кнопку ниже.</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Совет: если заголовки не в первой строке, в рабочем экране можно будет
                  выбрать строку заголовков.
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
                  <span>
                    Выбрано:{" "}
                    <span className="font-medium text-slate-900">
                      {files.map((f) => f.name).join(", ")}
                    </span>
                  </span>
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

                <button
                  type="button"
                  disabled={!files.length}
                  onClick={() => router.push("/workspace")}
                  className={[
                    "inline-flex items-center justify-center rounded-2xl border px-5 py-3 text-sm font-medium shadow-sm",
                    files.length
                      ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
                  ].join(" ")}
                >
                  Открыть рабочее пространство
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
      </div>
    </main>
  );
}
