"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SigningStampPreview from "@/app/components/SigningStampPreview";

type SigningPlacementMode = "last_page" | "all_pages";

export type SigningStampTemplateValue = {
  placementMode: SigningPlacementMode;
  columnCount: 1 | 2;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

type SigningStampSigner = {
  id: number;
  name: string;
  username: string;
};

type SigningStampPlacementModalProps = {
  file: File;
  signers: SigningStampSigner[];
  initialValue: SigningStampTemplateValue | null;
  onClose: () => void;
  onConfirm: (value: SigningStampTemplateValue) => void;
};

type PageSize = {
  width: number;
  height: number;
};

type DragState = {
  offsetX: number;
  offsetY: number;
  frameLeft: number;
  frameTop: number;
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeColumnCount(value: number | undefined | null): 1 | 2 {
  return value === 2 ? 2 : 1;
}

export default function SigningStampPlacementModal({
  file,
  signers,
  initialValue,
  onClose,
  onConfirm,
}: SigningStampPlacementModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const didMountRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [placementMode, setPlacementMode] = useState<SigningPlacementMode>(
    initialValue?.placementMode ?? "last_page"
  );
  const [columnCount, setColumnCount] = useState<1 | 2>(normalizeColumnCount(initialValue?.columnCount));
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState("");
  const [blockPosition, setBlockPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const horizontalInset = useMemo(() => {
    const pageWidth = pageSize?.width ?? 720;
    return clamp(pageWidth * 0.024, 18, 28);
  }, [pageSize]);

  const blockSize = useMemo(() => {
    const stampAspectRatio = columnCount === 2 ? 1080 / 300 : 1080 / 250;
    const pageWidth = pageSize?.width ?? 720;
    const pageHeight = pageSize?.height ?? 960;
    const rows = Math.max(1, Math.ceil(signers.length / columnCount));
    const gap = 10;
    const desiredWidth =
      columnCount === 2
        ? clamp(pageWidth * 0.76, 560, 760)
        : clamp(pageWidth * 0.48, 340, 470);
    const width = Math.min(desiredWidth, Math.max(220, pageWidth - horizontalInset * 2));
    const cardWidth = (width - gap * Math.max(columnCount - 1, 0)) / Math.max(columnCount, 1);
    const cardHeight = Math.max(1, cardWidth / stampAspectRatio);
    const desiredHeight = rows * cardHeight + Math.max(rows - 1, 0) * gap;

    return {
      width,
      height: Math.min(desiredHeight, Math.max(72, pageHeight - horizontalInset * 2)),
      cardHeight,
      gap,
    };
  }, [columnCount, horizontalInset, pageSize, signers.length]);

  const constrainPosition = (x: number, y: number) => {
    if (!pageSize) return { x: 0, y: 0 };
    return {
      x: clamp(x, horizontalInset, Math.max(horizontalInset, pageSize.width - blockSize.width - horizontalInset)),
      y: clamp(y, 0, Math.max(0, pageSize.height - blockSize.height)),
    };
  };

  useEffect(() => {
    let revoked = false;

    const renderPdf = async () => {
      setRendering(true);
      setRenderError("");

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const fileBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(fileBuffer) });
        const pdfDocument = await loadingTask.promise;
        const lastPageNumber = pdfDocument.numPages;
        const page = await pdfDocument.getPage(lastPageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const maxWidth = Math.min(window.innerWidth - 560, 940);
        const scale = Math.min(1.7, maxWidth / baseViewport.width);
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;

        if (!canvas || revoked) return;

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas is not available");
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        await page.render({ canvasContext: context, viewport, transform, canvas }).promise;

        if (revoked) return;

        setPageSize({ width: viewport.width, height: viewport.height });
        setPageCount(pdfDocument.numPages);
      } catch (error) {
        console.error("Failed to render PDF preview:", error);
        if (!revoked) {
          setRenderError("Не удалось открыть PDF для размещения штампов");
          setPageSize(null);
          setPageCount(0);
        }
      } finally {
        if (!revoked) setRendering(false);
      }
    };

    void renderPdf();
    return () => {
      revoked = true;
    };
  }, [file]);

  useEffect(() => {
    if (!pageSize) return;

    if (initialValue) {
      setBlockPosition(
        constrainPosition(initialValue.xRatio * pageSize.width, initialValue.yRatio * pageSize.height)
      );
      didMountRef.current = true;
      return;
    }

    if (didMountRef.current) return;

    const defaultX = (pageSize.width - blockSize.width) / 2;
    const defaultY = pageSize.height - blockSize.height - 24;
    setBlockPosition(constrainPosition(defaultX, defaultY));
    didMountRef.current = true;
  }, [blockSize.height, blockSize.width, initialValue, pageSize]);

  useEffect(() => {
    if (!pageSize) return;
    setBlockPosition((current) => constrainPosition(current.x, current.y));
  }, [blockSize.height, blockSize.width, horizontalInset, pageSize]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;

      const next = constrainPosition(
        event.clientX - drag.frameLeft - drag.offsetX,
        event.clientY - drag.frameTop - drag.offsetY
      );
      setBlockPosition(next);
    };

    const handleUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const previewBody = (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/28 px-4 py-4 backdrop-blur-sm sm:py-6">
      <div className="relative my-auto flex max-h-[92vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-[32px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-6 border-b border-slate-200/80 px-6 py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Размещение штампов
            </div>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Подготовьте шаблон подписей</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Переместите общий блок штампов туда, где должны появляться подписи. Сейчас показывается
              последний лист PDF.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 overflow-auto bg-slate-100/75 px-6 py-6">
            <div className="mx-auto flex w-fit flex-col items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                PDF • {pageCount > 0 ? `${pageCount} стр.` : "загрузка"} • {placementMode === "last_page" ? "штампы только на последнем листе" : "штампы на всех листах"}
              </div>

              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                {renderError ? (
                  <div className="flex min-h-[540px] w-[760px] items-center justify-center px-8 text-center text-sm text-rose-600">
                    {renderError}
                  </div>
                ) : (
                  <div ref={previewFrameRef} className="relative">
                    <canvas ref={canvasRef} className="block bg-white" />
                    {pageSize ? (
                      <div className="pointer-events-none absolute inset-0">
                        <div
                          className="pointer-events-auto absolute select-none cursor-grab active:cursor-grabbing"
                          style={{
                            left: `${blockPosition.x}px`,
                            top: `${blockPosition.y}px`,
                            width: `${blockSize.width}px`,
                            height: `${blockSize.height}px`,
                            touchAction: "none",
                          }}
                          onPointerDown={(event) => {
                            if (!previewFrameRef.current) return;
                            event.preventDefault();
                            const targetRect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                            const frameRect = previewFrameRef.current.getBoundingClientRect();
                            dragStateRef.current = {
                              offsetX: event.clientX - targetRect.left,
                              offsetY: event.clientY - targetRect.top,
                              frameLeft: frameRect.left,
                              frameTop: frameRect.top,
                            };
                          }}
                          title="Перетащите блок штампов в нужное место"
                        >
                          <SigningStampPreview
                            signers={signers}
                            compact
                            columns={columnCount}
                            showContainer={false}
                            className="h-full"
                            cardHeightPx={blockSize.cardHeight}
                            gapPx={blockSize.gap}
                          />
                        </div>
                      </div>
                    ) : null}
                    {rendering ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/65 backdrop-blur-[1px]">
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg">
                          Готовим превью PDF...
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white/94 p-6 lg:border-l lg:border-t-0">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Настройки</div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-sm font-semibold text-slate-900">Куда ставить блок штампов</div>
                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 transition hover:border-slate-300">
                    <input
                      type="radio"
                      name="placementMode"
                      className="mt-0.5 h-4 w-4 border-slate-300 text-slate-900"
                      checked={placementMode === "last_page"}
                      onChange={() => setPlacementMode("last_page")}
                    />
                    <span>
                      <span className="block font-medium text-slate-900">Только на последнем листе</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Базовый и самый безопасный вариант для многошагового подписания.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 transition hover:border-slate-300">
                    <input
                      type="radio"
                      name="placementMode"
                      className="mt-0.5 h-4 w-4 border-slate-300 text-slate-900"
                      checked={placementMode === "all_pages"}
                      onChange={() => setPlacementMode("all_pages")}
                    />
                    <span>
                      <span className="block font-medium text-slate-900">На всех листах</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Блок будет повторяться на каждой странице PDF в одинаковом месте.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-sm font-semibold text-slate-900">Компоновка штампов</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[1, 2].map((value) => {
                    const active = columnCount === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setColumnCount(value as 1 | 2)}
                        className={cls(
                          "rounded-xl border px-3 py-2 text-sm transition",
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        {value} {value === 1 ? "колонка" : "колонки"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-sm font-semibold text-slate-900">Подписанты</div>
                <div className="mt-3 space-y-2">
                  {signers.map((signer, index) => (
                    <div
                      key={signer.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{signer.name}</div>
                        <div className="text-xs text-slate-500">@{signer.username}</div>
                      </div>
                      <div className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {index + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-auto flex items-center justify-end gap-3 pt-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pageSize) return;
                  onConfirm({
                    placementMode,
                    columnCount,
                    xRatio: blockPosition.x / pageSize.width,
                    yRatio: blockPosition.y / pageSize.height,
                    widthRatio: blockSize.width / pageSize.width,
                    heightRatio: blockSize.height / pageSize.height,
                  });
                }}
                disabled={!pageSize || !!renderError}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Сохранить размещение
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(previewBody, document.body) : null;
}
