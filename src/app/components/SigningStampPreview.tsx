"use client";

type SigningStampPreviewSigner = {
  id: number;
  name: string;
  username?: string | null;
};

type SigningStampPreviewProps = {
  signers: SigningStampPreviewSigner[];
  className?: string;
  compact?: boolean;
  logoSrc?: string;
  columns?: 1 | 2;
  showContainer?: boolean;
  cardHeightPx?: number;
  gapPx?: number;
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatShortDate(date: Date) {
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sampleThumbprint(index: number) {
  return `49AA5CDEAB31A229610108426E56C3DC885D72${String(50 + index).padStart(2, "0")}`;
}

function toShortSignerName(fullName: string) {
  return fullName.trim();
}

export default function SigningStampPreview({
  signers,
  className,
  compact = false,
  logoSrc = "/logo.png",
  columns = 1,
  showContainer = true,
  cardHeightPx,
  gapPx = 10,
}: SigningStampPreviewProps) {
  const now = new Date();

  const validFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const thumbClass = compact ? "text-[8px] leading-3" : "text-[9px] leading-3.5";

  return (
    <div
      className={cls(
        showContainer
          ? "w-full rounded-[22px] border-2 border-indigo-500/55 bg-white/92 p-2.5 text-indigo-950 shadow-[0_8px_20px_rgba(55,48,163,0.1),inset_0_1px_0_rgba(255,255,255,0.92)]"
          : "w-full bg-transparent p-0 text-indigo-950",
        className
      )}
    >
      <div
        className={cls("grid", columns === 2 ? "grid-cols-2" : "grid-cols-1")}
        style={{ gap: `${gapPx}px` }}
      >
        {signers.map((signer, index) => (
          <div
            key={signer.id}
            className={cls(
              "rounded-[18px] border-2 border-indigo-500/65 bg-white px-3 py-2.5",
              cardHeightPx ? undefined : compact ? "min-h-[88px]" : "min-h-[98px]"
            )}
            style={cardHeightPx ? { height: `${cardHeightPx}px` } : undefined}
          >
            <div className="flex items-start gap-3">
              <div
                className={cls(
                  "flex shrink-0 items-center justify-center rounded-[14px] border border-indigo-200 bg-indigo-50 p-1.5 text-indigo-700",
                  compact ? "h-11 w-11" : "h-14 w-14"
                )}
              >
                <img
                  src={logoSrc}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className={cls(
                    "font-bold uppercase tracking-[0.06em] text-indigo-800",
                    compact ? "text-[10px] leading-3.5" : "text-[11px] leading-4"
                  )}
                >
                  Документ подписан
                </div>
                <div
                  className={cls(
                    "font-semibold uppercase tracking-[0.04em] text-indigo-700",
                    compact ? "text-[9px] leading-3.5" : "text-[10px] leading-3.5"
                  )}
                >
                  электронной подписью
                </div>

                <div
                  className={cls(
                    "mt-1.5 grid gap-0.5 text-indigo-950",
                    compact ? "text-[10px] leading-4" : "text-[11px] leading-4"
                  )}
                >
                  <div className="min-w-0">
                    <span className="font-semibold">Подписант:</span>{" "}
                    <span className="truncate align-bottom">{toShortSignerName(signer.name)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className={cls("min-w-0 text-indigo-900", thumbClass)}>
                      <span className="font-semibold">Сертификат:</span>{" "}
                      <span className="truncate align-bottom">{sampleThumbprint(index + 1)}</span>
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold">Срок действия:</span> с{" "}
                    {formatShortDate(validFrom).slice(0, 10)} по {formatShortDate(now).slice(0, 10)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
