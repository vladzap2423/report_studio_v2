"use client";

import { useMemo, useState } from "react";
import {
  getCryptoProDiagnostics,
  listCryptoProCertificates,
  type CryptoProCertificate,
  type CryptoProDiagnostics,
} from "@/app/tasks/cryptopro";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

function extractCommonName(subject: string) {
  const chunk = subject
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("CN="));

  return chunk ? chunk.slice(3) : subject;
}

export default function CryptoProAdminPanel() {
  const [diagnostics, setDiagnostics] = useState<CryptoProDiagnostics | null>(null);
  const [certificates, setCertificates] = useState<CryptoProCertificate[]>([]);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState("");

  const certificatesCountLabel = useMemo(() => {
    if (loadingCertificates) return "Читаем хранилище...";
    return `${certificates.length} сертификатов`;
  }, [certificates.length, loadingCertificates]);

  const handleDiagnostics = async () => {
    setLoadingDiagnostics(true);
    setError("");
    setLastAction("Проверка API");

    try {
      const payload = await getCryptoProDiagnostics();
      setDiagnostics(payload);
    } catch (err: any) {
      setError(err?.message || "Не удалось получить диагностику CryptoPro.");
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const handleLoadCertificates = async () => {
    setLoadingCertificates(true);
    setError("");
    setLastAction("Чтение сертификатов");

    try {
      const payload = await listCryptoProCertificates();
      setCertificates(payload);
      const state = await getCryptoProDiagnostics().catch(() => null);
      if (state) setDiagnostics(state);
    } catch (err: any) {
      setError(err?.message || "Не удалось прочитать сертификаты из хранилища.");
    } finally {
      setLoadingCertificates(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">CryptoPro</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Тестовая страница для проверки Browser plug-in. Здесь можно отдельно
                проверить инициализацию API и прочитать сертификаты из хранилища текущего
                пользователя.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleDiagnostics()}
                disabled={loadingDiagnostics || loadingCertificates}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingDiagnostics ? "Проверяем..." : "Проверить API"}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadCertificates()}
                disabled={loadingDiagnostics || loadingCertificates}
                className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingCertificates ? "Читаем..." : "Получить сертификаты"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Диагностика
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">Состояние API</h2>
              </div>
              {lastAction ? <span className="text-xs text-slate-400">{lastAction}</span> : null}
            </div>

            {diagnostics ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">Origin</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">{diagnostics.origin || "—"}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">JSModuleVersion</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.jsModuleVersion || "не определена"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">window.cadesplugin</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasGlobal ? "есть" : "нет"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">Promise-ветка</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasThen ? "да" : "нет"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">CreateObjectAsync</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasCreateObjectAsync ? "доступен" : "недоступен"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">CreateObject</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasCreateObject ? "доступен" : "недоступен"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">set</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasSet ? "доступен" : "недоступен"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">async_spawn</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.hasAsyncSpawn ? "доступен" : "недоступен"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">Тип объекта</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.objectType || "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-xs text-slate-400">Constructor</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">
                    {diagnostics.constructorName || "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-slate-400">Object tag</div>
                  <div className="mt-1 break-words text-sm font-medium text-slate-800">
                    {diagnostics.objectTag || "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-slate-400">User-Agent</div>
                  <div className="mt-1 break-words text-sm font-medium text-slate-800">
                    {diagnostics.userAgent || "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-slate-400">Loader scripts</div>
                  <div className="mt-1 space-y-1 text-sm font-medium text-slate-800">
                    {diagnostics.loaderScriptSources.length > 0 ? (
                      diagnostics.loaderScriptSources.map((src) => (
                        <div key={src} className="break-all">
                          {src}
                        </div>
                      ))
                    ) : (
                      <div>—</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-slate-400">Ключи объекта</div>
                  <div className="mt-1 max-h-36 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    {diagnostics.ownKeys.length > 0 ? diagnostics.ownKeys.join(", ") : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-sm text-slate-500">
                Нажмите `Проверить API`, чтобы увидеть состояние Browser plug-in на этой
                странице.
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Хранилище
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">Сертификаты</h2>
              </div>
              <span className="text-xs text-slate-400">{certificatesCountLabel}</span>
            </div>

            {certificates.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-sm text-slate-500">
                Нажмите `Получить сертификаты`, чтобы открыть хранилище и прочитать
                доступные сертификаты текущего пользователя.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {certificates.map((certificate) => (
                  <article
                    key={certificate.thumbprint}
                    className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {extractCommonName(certificate.subject)}
                        </div>
                        <div className="mt-1 break-words text-xs text-slate-500">
                          {certificate.subject}
                        </div>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                        до {formatDate(certificate.validTo)}
                      </div>
                    </div>

                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-slate-400">Отпечаток</dt>
                        <dd className="mt-1 break-all text-slate-700">{certificate.thumbprint}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Серийный номер</dt>
                        <dd className="mt-1 break-all text-slate-700">{certificate.serialNumber || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Издатель</dt>
                        <dd className="mt-1 break-words text-slate-700">{certificate.issuer || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Действует с</dt>
                        <dd className="mt-1 text-slate-700">{formatDate(certificate.validFrom)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
