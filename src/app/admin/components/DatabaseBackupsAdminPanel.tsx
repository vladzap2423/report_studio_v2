"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useToastSync } from "@/app/components/AppToastProvider";

type BackupKind = "manual" | "auto" | "pre_restore";

type BackupItem = {
  fileName: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: string;
};

type CatalogBackupItem = {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

type ToolsStatus = {
  pgDump: boolean;
  pgRestore: boolean;
  database: string;
};

function backupKindLabel(kind: BackupKind) {
  if (kind === "pre_restore") return "Перед восстановлением";
  if (kind === "auto") return "Автоматический";
  return "Ручной";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

export default function DatabaseBackupsAdminPanel() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [catalogBackups, setCatalogBackups] = useState<CatalogBackupItem[]>([]);
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [storageDir, setStorageDir] = useState("");
  const [catalogStorageDir, setCatalogStorageDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingCatalog, setCreatingCatalog] = useState(false);
  const [restoreFileName, setRestoreFileName] = useState<string | null>(null);
  const [restoreCatalogFileName, setRestoreCatalogFileName] = useState<string | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoreCatalogConfirmation, setRestoreCatalogConfirmation] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoringCatalog, setRestoringCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  const selectedBackup = useMemo(
    () => backups.find((item) => item.fileName === restoreFileName) || null,
    [backups, restoreFileName]
  );
  const selectedCatalogBackup = useMemo(
    () => catalogBackups.find((item) => item.fileName === restoreCatalogFileName) || null,
    [catalogBackups, restoreCatalogFileName]
  );

  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [dbRes, catalogRes] = await Promise.all([
        fetch("/api/db-backups", { cache: "no-store" }),
        fetch("/api/catalog-backups", { cache: "no-store" }),
      ]);

      const [dbData, catalogData] = await Promise.all([
        dbRes.json().catch(() => null) as Promise<
          | { error?: string; backups?: BackupItem[]; tools?: ToolsStatus; storageDir?: string }
          | null
        >,
        catalogRes.json().catch(() => null) as Promise<
          | { error?: string; backups?: CatalogBackupItem[]; storageDir?: string }
          | null
        >,
      ]);

      if (!dbRes.ok) {
        throw new Error(dbData?.error || "Не удалось загрузить резервные копии базы.");
      }
      if (!catalogRes.ok) {
        throw new Error(catalogData?.error || "Не удалось загрузить backup-файлы справочников.");
      }

      setBackups(Array.isArray(dbData?.backups) ? dbData.backups : []);
      setCatalogBackups(Array.isArray(catalogData?.backups) ? catalogData.backups : []);
      setTools(dbData?.tools || null);
      setStorageDir(dbData?.storageDir || "");
      setCatalogStorageDir(catalogData?.storageDir || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить резервные копии.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const createBackup = useCallback(async () => {
    setCreating(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/db-backups", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; backup?: BackupItem }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось создать резервную копию.");
      }

      if (data?.backup) {
        setBackups((current) => [data.backup!, ...current]);
      } else {
        await loadBackups();
      }

      setMessage("Резервная копия базы данных создана.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать резервную копию.");
    } finally {
      setCreating(false);
    }
  }, [loadBackups]);

  const createCatalogBackup = useCallback(async () => {
    setCreatingCatalog(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/catalog-backups", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; backup?: CatalogBackupItem }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось создать backup справочников.");
      }

      if (data?.backup) {
        setCatalogBackups((current) => [data.backup!, ...current]);
      } else {
        await loadBackups();
      }

      setMessage("Backup справочников services и profiles создан.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать backup справочников.");
    } finally {
      setCreatingCatalog(false);
    }
  }, [loadBackups]);

  const restoreBackup = useCallback(async () => {
    if (!selectedBackup) return;

    setRestoring(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/db-backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedBackup.fileName,
          confirmation: restoreConfirmation.trim(),
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось восстановить базу данных.");
      }

      setMessage(data?.message || "Восстановление базы данных завершено.");
      setRestoreFileName(null);
      setRestoreConfirmation("");
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось восстановить базу данных.");
    } finally {
      setRestoring(false);
    }
  }, [loadBackups, restoreConfirmation, selectedBackup]);

  const restoreCatalogBackup = useCallback(async () => {
    if (!selectedCatalogBackup) return;

    setRestoringCatalog(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/catalog-backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedCatalogBackup.fileName,
          confirmation: restoreCatalogConfirmation.trim(),
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось восстановить справочники.");
      }

      setMessage(data?.message || "Справочники services и profiles восстановлены.");
      setRestoreCatalogFileName(null);
      setRestoreCatalogConfirmation("");
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось восстановить справочники.");
    } finally {
      setRestoringCatalog(false);
    }
  }, [loadBackups, restoreCatalogConfirmation, selectedCatalogBackup]);

  return (
    <>
      <div className="h-full overflow-auto p-5">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Резервные копии базы данных</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Безопасный режим: ручное создание dump, скачивание и восстановление с обязательным
                  подтверждением. Перед restore система автоматически делает дополнительную копию
                  текущей базы.
                </p>
              </div>

              <button
                type="button"
                onClick={createBackup}
                disabled={creating || !tools?.pgDump}
                className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Создание backup..." : "Создать backup"}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  База данных
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {tools?.database || "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Утилиты PostgreSQL
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      tools?.pgDump
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    pg_dump {tools?.pgDump ? "найден" : "не найден"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      tools?.pgRestore
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    pg_restore {tools?.pgRestore ? "найден" : "не найден"}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Хранилище
                </div>
                <div className="mt-2 break-all text-sm text-slate-700">{storageDir || "—"}</div>
              </div>
            </div>

            {(!tools?.pgDump || !tools?.pgRestore) && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Для работы backup-раздела PostgreSQL bin должен быть доступен в PATH или через
                переменные окружения `PG_DUMP_PATH` и `PG_RESTORE_PATH`.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Автоматический backup</h3>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Внутренний планировщик в `next start` не включаю намеренно: для dump базы это
                  менее надежно, чем системный планировщик. Правильнее вешать автоматические
                  backup-задачи через Windows Task Scheduler или отдельный сервис.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Если нужен именно автоматический режим, следующим шагом правильнее добавить отдельную
              интеграцию с системным планировщиком, а не запускать backup по таймеру внутри веб-приложения.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Справочник услуг и профили
                </h3>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Отдельный безопасный backup таблиц `services` и `profiles` в JSON. Этот режим
                  работает без `pg_dump` и подходит именно для справочников.
                </p>
              </div>

              <button
                type="button"
                onClick={createCatalogBackup}
                disabled={creatingCatalog}
                className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingCatalog ? "Создание backup..." : "Backup справочников"}
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Хранилище справочников
              </div>
              <div className="mt-2 break-all text-sm text-slate-700">
                {catalogStorageDir || "—"}
              </div>
            </div>

            <div className="mt-4">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Загружаем backup-файлы справочников...
                </div>
              ) : catalogBackups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Пока нет ни одного backup-файла для services/profiles.
                </div>
              ) : (
                <div className="space-y-3">
                  {catalogBackups.map((backup) => (
                    <div
                      key={backup.fileName}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {backup.fileName}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{formatDate(backup.createdAt)}</span>
                          <span>{formatBytes(backup.sizeBytes)}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={`/api/catalog-backups/download?fileName=${encodeURIComponent(backup.fileName)}`}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          Скачать
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreCatalogFileName(backup.fileName);
                            setRestoreCatalogConfirmation("");
                          }}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                        >
                          Восстановить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Список backup-файлов</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Можно скачать dump или восстановить базу из выбранной копии.
                </p>
              </div>
            </div>

            <div className="mt-4">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Загружаем список резервных копий...
                </div>
              ) : backups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Пока нет ни одной резервной копии.
                </div>
              ) : (
                <div className="space-y-3">
                  {backups.map((backup) => (
                    <div
                      key={backup.fileName}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {backup.fileName}
                          </div>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
                            {backupKindLabel(backup.kind)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{formatDate(backup.createdAt)}</span>
                          <span>{formatBytes(backup.sizeBytes)}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={`/api/db-backups/download?fileName=${encodeURIComponent(backup.fileName)}`}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          Скачать
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreFileName(backup.fileName);
                            setRestoreConfirmation("");
                          }}
                          disabled={!tools?.pgRestore}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Восстановить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedBackup && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/25 backdrop-blur-sm">
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Восстановление базы</div>
                      <div className="mt-1 text-sm text-slate-500">
                        Операция destructive. Перед restore будет создан дополнительный backup текущей базы.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreFileName(null);
                        setRestoreConfirmation("");
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-lg text-slate-600 shadow-sm transition-colors hover:bg-white"
                      aria-label="Закрыть"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Перед восстановлением убедитесь, что в системе нет активной работы пользователей.
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Backup-файл
                    </div>
                    <div className="mt-2 break-all text-sm font-medium text-slate-900">
                      {selectedBackup.fileName}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Для подтверждения введите точное имя backup-файла
                    </label>
                    <input
                      type="text"
                      value={restoreConfirmation}
                      onChange={(event) => setRestoreConfirmation(event.target.value)}
                      className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
                    />
                  </div>

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreFileName(null);
                        setRestoreConfirmation("");
                      }}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={restoreBackup}
                      disabled={restoring || restoreConfirmation.trim() !== selectedBackup.fileName}
                      className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restoring ? "Восстановление..." : "Подтвердить restore"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {selectedCatalogBackup && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/25 backdrop-blur-sm">
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Восстановление справочников
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Будут восстановлены только таблицы `services` и `profiles`. Перед restore
                        система создаст дополнительный JSON-backup текущих справочников.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreCatalogFileName(null);
                        setRestoreCatalogConfirmation("");
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-lg text-slate-600 shadow-sm transition-colors hover:bg-white"
                      aria-label="Закрыть"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Текущие значения в `services` и `profiles` будут полностью заменены данными из backup.
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Backup-файл
                    </div>
                    <div className="mt-2 break-all text-sm font-medium text-slate-900">
                      {selectedCatalogBackup.fileName}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Для подтверждения введите точное имя backup-файла
                    </label>
                    <input
                      type="text"
                      value={restoreCatalogConfirmation}
                      onChange={(event) => setRestoreCatalogConfirmation(event.target.value)}
                      className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-4 focus:ring-slate-200"
                    />
                  </div>

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreCatalogFileName(null);
                        setRestoreCatalogConfirmation("");
                      }}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={restoreCatalogBackup}
                      disabled={
                        restoringCatalog ||
                        restoreCatalogConfirmation.trim() !== selectedCatalogBackup.fileName
                      }
                      className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restoringCatalog ? "Восстановление..." : "Подтвердить restore"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
