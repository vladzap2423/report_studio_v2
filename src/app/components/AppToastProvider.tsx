"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AppToastViewport, { type AppToastItem, type AppToastTone } from "./AppToastViewport";

type AppToastOptions = {
  duration?: number;
  tone?: AppToastTone;
};

type AppToastContextValue = {
  dismissToast: (id: string) => void;
  pushToast: (message: string, options?: AppToastOptions) => void;
  showError: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
};

type ToastSyncOptions = {
  error?: string | null;
  errorDuration?: number;
  clearError?: () => void;
  message?: string | null;
  messageDuration?: number;
  messageTone?: AppToastTone;
  clearMessage?: () => void;
};

const AppToastContext = createContext<AppToastContextValue | null>(null);

function getDefaultDuration(tone: AppToastTone) {
  return tone === "error" ? 5200 : 3200;
}

export function AppToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timeoutsRef = useRef<Map<string, number>>(new Map());
  const lastToastRef = useRef<{ at: number; message: string; tone: AppToastTone } | null>(null);

  const dismissToast = useCallback((id: string) => {
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }

    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, options?: AppToastOptions) => {
      const normalized = message.trim();
      if (!normalized) return;

      const tone = options?.tone ?? "info";
      const now = Date.now();
      const lastToast = lastToastRef.current;

      if (
        lastToast &&
        lastToast.message === normalized &&
        lastToast.tone === tone &&
        now - lastToast.at < 300
      ) {
        return;
      }

      lastToastRef.current = { at: now, message: normalized, tone };

      const id = `toast:${nextIdRef.current++}`;
      setItems((prev) => [
        ...prev.slice(-3),
        {
          id,
          tone,
          message: normalized,
          onClose: () => dismissToast(id),
        },
      ]);

      const timeoutId = window.setTimeout(
        () => dismissToast(id),
        options?.duration ?? getDefaultDuration(tone)
      );
      timeoutsRef.current.set(id, timeoutId);
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current.clear();
    };
  }, []);

  const value = useMemo<AppToastContextValue>(
    () => ({
      dismissToast,
      pushToast,
      showError: (message, duration) => pushToast(message, { tone: "error", duration }),
      showInfo: (message, duration) => pushToast(message, { tone: "info", duration }),
      showSuccess: (message, duration) => pushToast(message, { tone: "success", duration }),
    }),
    [dismissToast, pushToast]
  );

  return (
    <AppToastContext.Provider value={value}>
      {children}
      <AppToastViewport items={items} />
    </AppToastContext.Provider>
  );
}

export function useAppToast() {
  const context = useContext(AppToastContext);
  if (!context) {
    throw new Error("useAppToast must be used within AppToastProvider");
  }
  return context;
}

export function useToastSync({
  error,
  errorDuration,
  clearError,
  message,
  messageDuration,
  messageTone = "success",
  clearMessage,
}: ToastSyncOptions) {
  const { pushToast } = useAppToast();
  const handledMessageRef = useRef<string | null>(null);
  const handledErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) {
      handledMessageRef.current = null;
      return;
    }

    if (handledMessageRef.current === message) return;
    handledMessageRef.current = message;
    pushToast(message, { tone: messageTone, duration: messageDuration });
    clearMessage?.();
  }, [clearMessage, message, messageDuration, messageTone, pushToast]);

  useEffect(() => {
    if (!error) {
      handledErrorRef.current = null;
      return;
    }

    if (handledErrorRef.current === error) return;
    handledErrorRef.current = error;
    pushToast(error, { tone: "error", duration: errorDuration });
    clearError?.();
  }, [clearError, error, errorDuration, pushToast]);
}
