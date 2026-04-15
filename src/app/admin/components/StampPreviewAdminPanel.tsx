"use client";

import { useMemo, useState } from "react";
import SigningStampPreview from "@/app/components/SigningStampPreview";

const SAMPLE_SIGNERS = [
  { id: 1, name: "Войцеховский Никита Олегович", username: "nikita" },
  { id: 2, name: "Запороцкий Владислав Вадимович", username: "vladzap" },
  { id: 3, name: "Кузьменко Юлия Сергеевна", username: "yuliya" },
  { id: 4, name: "Арахамия Лариса Тариеловна", username: "larisa" },
];

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function StampPreviewAdminPanel() {
  const [signerCount, setSignerCount] = useState(2);
  const [compact, setCompact] = useState(false);

  const signers = useMemo(() => SAMPLE_SIGNERS.slice(0, signerCount), [signerCount]);

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-7">
      <div className="mb-6 rounded-[28px] border border-slate-200 bg-white/90 px-6 py-6 shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-slate-900">Макет штампа</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Временный стенд для согласования внешнего вида штампа до следующего шага с PDF.
            Здесь настраивается только макет. Реальная криптографическая подпись не выполняется.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Настройки
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-semibold text-slate-900">Количество подписантов</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSignerCount(value)}
                  className={cls(
                    "rounded-xl border px-3 py-2 text-sm transition",
                    signerCount === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-semibold text-slate-900">Плотность макета</div>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setCompact(false)}
                className={cls(
                  "w-full rounded-xl border px-3 py-2 text-left text-sm transition",
                  !compact
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                )}
              >
                Обычный
              </button>
              <button
                type="button"
                onClick={() => setCompact(true)}
                className={cls(
                  "w-full rounded-xl border px-3 py-2 text-left text-sm transition",
                  compact
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                )}
              >
                Компактный
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-semibold text-slate-900">Состав блока</div>
            <div className="mt-3 space-y-2">
              {signers.map((signer, index) => (
                <div
                  key={signer.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{signer.name}</div>
                    <div className="truncate text-xs text-slate-500">@{signer.username}</div>
                  </div>
                  <div className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-h-0 rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),rgba(241,245,249,0.92))] p-6 shadow-[0_12px_35px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Предпросмотр
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Общий блок на всю ширину PDF. Высота зависит от количества подписантов.
              </div>
            </div>
          </div>

          <div className="flex min-h-[720px] items-start justify-center overflow-auto rounded-[26px] border border-slate-200 bg-slate-100/80 p-8">
            <div className="w-full max-w-[860px] rounded-[18px] border border-slate-300 bg-white px-8 pb-12 pt-10 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <div className="mx-auto max-w-[650px] text-[14px] leading-7 text-slate-900">
                <p>
                  Выписка сформирована с использованием сервиса предоставления сведений в форме
                  электронного документа и подписана усиленной электронной подписью.
                </p>
                <p className="mt-4">
                  Ниже расположен тестовый блок штампов, который должен визуально повторять то, что
                  потом будет попадать в итоговый PDF.
                </p>
              </div>

              <div className="mt-16">
                <SigningStampPreview
                  signers={signers}
                  compact={compact}
                  className="max-w-[360px]"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
