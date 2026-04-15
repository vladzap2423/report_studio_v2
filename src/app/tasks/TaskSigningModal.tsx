"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listCryptoProCertificates, signBase64WithCryptoPro, type CryptoProCertificate } from "@/app/tasks/cryptopro";

type SigningTaskModalTask = {
  id: number;
  title: string;
  document_name?: string | null;
};

type SignedTaskPayload = {
  task: unknown;
  completed: boolean;
  nextSignerName: string | null;
  signedStepOrder: number | null;
};

type TaskSigningModalProps = {
  open: boolean;
  task: SigningTaskModalTask | null;
  onClose: () => void;
  onSigned: (payload: SignedTaskPayload) => void;
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function extractCommonName(subject: string) {
  const chunk = subject
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("CN="));

  return chunk ? chunk.slice(3) : subject;
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU");
}

export default function TaskSigningModal({ open, task, onClose, onSigned }: TaskSigningModalProps) {
  const [certificates, setCertificates] = useState<CryptoProCertificate[]>([]);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  const [selectedThumbprint, setSelectedThumbprint] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");

  const loadCertificates = useCallback(async () => {
    setLoadingCertificates(true);
    setError("");
    setCertificates([]);
    setSelectedThumbprint("");

    try {
      const items = await listCryptoProCertificates();
      setCertificates(items);
      if (items.length > 0) {
        setSelectedThumbprint(items[0].thumbprint);
      }
    } catch (err: any) {
      setError(err?.message || "Не удалось загрузить сертификаты CryptoPro");
    } finally {
      setLoadingCertificates(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !task) return;
    void loadCertificates();
  }, [loadCertificates, open, task]);

  const selectedCertificate = useMemo(
    () => certificates.find((certificate) => certificate.thumbprint === selectedThumbprint) || null,
    [certificates, selectedThumbprint]
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !signing) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, signing]);

  if (!open || !task) return null;

  const handleSign = async () => {
    if (!selectedCertificate) {
      setError("Выберите сертификат для подписи");
      return;
    }

    try {
      setSigning(true);
      setError("");

      const prepareResponse = await fetch("/api/tasks/sign/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          taskId: task.id,
          certificate: {
            thumbprint: selectedCertificate.thumbprint,
            subject: selectedCertificate.subject,
            validFrom: selectedCertificate.validFrom,
            validTo: selectedCertificate.validTo,
          },
        }),
      });
      if (!prepareResponse.ok) {
        const payload = await prepareResponse.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error || "Не удалось подготовить PDF к подписи");
      }

      const preparePayload = (await prepareResponse.json()) as {
        sessionId?: string;
        bytesToSignBase64?: string;
        error?: string;
      };
      if (!preparePayload.sessionId || !preparePayload.bytesToSignBase64) {
        throw new Error(preparePayload.error || "Сервер не вернул данные для подписи");
      }

      const signingResult = await signBase64WithCryptoPro(
        preparePayload.bytesToSignBase64,
        selectedCertificate.thumbprint
      );

      const response = await fetch("/api/tasks/sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: task.id,
          sessionId: preparePayload.sessionId,
          signature: signingResult.signature,
          certificate: signingResult.certificate,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        task?: unknown;
        completed?: boolean;
        nextSignerName?: string | null;
        signedStepOrder?: number | null;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось сохранить подпись");
      }

      onSigned({
        task: payload.task,
        completed: Boolean(payload.completed),
        nextSignerName: payload.nextSignerName ?? null,
        signedStepOrder: payload.signedStepOrder ?? null,
      });
    } catch (err: any) {
      setError(err?.message || "Не удалось подписать документ");
    } finally {
      setSigning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm"
      onClick={() => {
        if (!signing) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl rounded-[28px] border border-white/70 bg-white/95 shadow-[0_22px_60px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-7 py-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
              Подписание CryptoPro
            </p>
            <h3 className="mt-2 text-[30px] font-semibold leading-none text-slate-950">Подписать документ</h3>
            <p className="mt-3 text-sm text-slate-600">{task.title}</p>
            {task.document_name ? <p className="mt-1 text-xs text-slate-400">{task.document_name}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={signing}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Закрыть"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="space-y-4 px-7 py-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Сертификаты</h4>
              <div className="flex items-center gap-2">
                {loadingCertificates ? <span className="text-xs text-slate-400">Загружаем...</span> : null}
                <button
                  type="button"
                  onClick={() => void loadCertificates()}
                  disabled={loadingCertificates || signing}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Обновить
                </button>
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {loadingCertificates ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Ищем сертификаты в хранилище CryptoPro...
              </div>
            ) : certificates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                В хранилище не найдено доступных сертификатов.
              </div>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                {certificates.map((certificate) => {
                  const active = certificate.thumbprint === selectedThumbprint;
                  return (
                    <button
                      key={certificate.thumbprint}
                      type="button"
                      onClick={() => setSelectedThumbprint(certificate.thumbprint)}
                      className={cls(
                        "flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition",
                        active
                          ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.16)]"
                          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{extractCommonName(certificate.subject)}</p>
                        <p className={cls("mt-1 text-xs", active ? "text-white/75" : "text-slate-500")}>
                          Действует до {formatDate(certificate.validTo)}
                        </p>
                      </div>
                      <span
                        className={cls(
                          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                          active
                            ? "border-white/35 bg-white/10 text-white"
                            : "border-slate-200 bg-slate-100 text-slate-500"
                        )}
                      >
                        {active ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={signing}
            className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleSign()}
            disabled={loadingCertificates || signing || !selectedCertificate}
            className="rounded-full border border-emerald-400/80 bg-[linear-gradient(180deg,rgba(220,252,231,1),rgba(187,247,208,0.95))] px-5 py-2.5 text-sm font-semibold text-emerald-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(5,46,22,0.08)] transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signing ? "Подписываем..." : "Подписать документ"}
          </button>
        </div>
      </div>
    </div>
  );
}
