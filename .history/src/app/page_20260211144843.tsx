"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accept = useMemo(
    () =>
      [
        ".csv",
        ".xlsx",
        ".xls",
      ].join(","),
    []
  );

  const persistAndGo = useCallback(
    (picked: File[]) => {
      // Временно: сохраняем только метаданные + сами файлы в памяти страницы.
      // Для реального чтения таблицы в /workspace мы будем парсить File там же.
      const meta: PickedFile[] = picked.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      }));
      sessionStorage.setItem("pickedFilesMeta", JSON.stringify(meta));

      // Сохраняем сами File в глобальном объекте окна, чтобы не кодировать в base64.
      // Это ок для MVP “без базы”. После перезагрузки страницы пропадёт.
      (window as any).__PICKED_FILES__ = picked;

      router.push("/workspace");
    },
    [router]
  );

  const validateFiles = useCallback((picked: File[]) => {
    setError(null);
    if (!picked.length) return null;

    // Примитивная проверка расширения
    const bad = picked.find((f) => {
      const n = f.name.toLowerCase();
      return !(n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls"));
    });
    if (bad) return `Файл "${bad.name}" не поддерживается. Разрешены CSV и Excel (XLSX/XLS).`;

    // Лимит, чтобы не уложить вкладку
    const total = picked.reduce((s, f) => s + f.size, 0);
    const maxTotal = 200 * 1024 * 1024; // 200MB
    if (total > maxTotal) return `Слишком большой объём (${formatBytes(total)}). Максимум ${formatBytes(maxTotal)}.`;

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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const picked = Array.from(e.dataTransfer.files || []);
      if (!picked.length) return;
      handlePicked(picked);
    },
    [handlePicked]
  );

  const onPickClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <header className="flex flex-col gap-4">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Загрузите данные и запускайте отчёты из папки scripts
          </h1>

          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Перетащите CSV/XLSX в большую зону или выберите файл вручную. Дальше вы сможете
            просматривать таблицу, редактировать и запускать один отчёт или группу.
          </p>
        </header>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          {/* Dropzone */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={onDrop}
            className={[
              "relative rounded-3xl border bg-white shadow-sm",
              "p-8 sm:p-10",
              "min-h-[320px] sm:min-h-[380px]",
              isDragging
                ? "border-emerald-300 ring-4 ring-emerald-100"
                : "border-slate-200 hover:border-slate-300",
            ].join(" ")}
          >
            <div className="flex h-full flex-col justify-between gap-8">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                    {/* простая “стрелка вверх” без зависимостей */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
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
                    <div className="text-lg font-semibold text-slate-900">
                      Большая зона загрузки
                    </div>
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
                    className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800 active:bg-slate-900"
                  >
                    Загрузить файл(ы)
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/workspace")}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
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

          {/* Right info card */}
          <aside className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Как это будет работать</div>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                Загружаете данные (CSV/XLSX)
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                Проверяете/правите таблицу (удалить строки, поправить ячейки)
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                Справа выбираете отчёт или группу из <span className="font-mono">scripts/</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                Жмёте “Выполнить” и скачиваете файл(ы)
              </li>
            </ul>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Сейчас это только UI. Позже подключим реальный запуск Python-скриптов на сервере.
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
