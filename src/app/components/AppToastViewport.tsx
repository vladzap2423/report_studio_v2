"use client";

type AppToastTone = "success" | "error" | "info";

type AppToastItem = {
  id: string;
  tone: AppToastTone;
  message: string;
  onClose?: () => void;
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const TONE_CLASSES: Record<AppToastTone, string> = {
  success:
    "border-emerald-200/80 bg-white/95 text-emerald-800 shadow-[0_18px_40px_rgba(16,185,129,0.16)]",
  error:
    "border-rose-200/80 bg-white/95 text-rose-800 shadow-[0_18px_40px_rgba(244,63,94,0.14)]",
  info: "border-slate-200/80 bg-white/95 text-slate-800 shadow-[0_18px_40px_rgba(15,23,42,0.12)]",
};

const DOT_CLASSES: Record<AppToastTone, string> = {
  success: "bg-emerald-500",
  error: "bg-rose-500",
  info: "bg-slate-500",
};

export type { AppToastItem, AppToastTone };

export default function AppToastViewport({ items }: { items: AppToastItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:bottom-6 sm:right-6">
      {items.map((item) => (
        <section
          key={item.id}
          role={item.tone === "error" ? "alert" : "status"}
          className={cls(
            "pointer-events-auto relative overflow-hidden rounded-2xl border px-4 py-3 backdrop-blur-sm",
            TONE_CLASSES[item.tone]
          )}
        >
          <div className="flex items-start gap-3 pr-8">
            <span
              aria-hidden="true"
              className={cls("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", DOT_CLASSES[item.tone])}
            />
            <p className="text-sm leading-5">{item.message}</p>
          </div>
          {item.onClose && (
            <button
              type="button"
              onClick={item.onClose}
              className="absolute right-2 top-2 rounded-full px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Закрыть уведомление"
            >
              ×
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
