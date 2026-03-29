"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

interface NavigatorWithSerial extends Navigator {
  serial?: {
    requestPort(): Promise<SerialPortLike>;
    addEventListener?: (type: "connect" | "disconnect", listener: EventListener) => void;
    removeEventListener?: (type: "connect" | "disconnect", listener: EventListener) => void;
  };
}

type SerialSupportState = {
  hasSerialApi: boolean;
  isSecureContext: boolean;
  isSupported: boolean;
  isDetected: boolean;
  reason: string | null;
};

type PendingLine = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const SLOT_COUNT = 6;

export default function PasswordPadAdminPage() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotPasswords, setSlotPasswords] = useState<string[]>(Array(SLOT_COUNT).fill(""));
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [newSlot, setNewSlot] = useState(1);
  const [newPassword, setNewPassword] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editingPassword, setEditingPassword] = useState("");
  const [visibleSlots, setVisibleSlots] = useState<number[]>([]);
  const [pinValue, setPinValue] = useState("0");
  const [serialSupport, setSerialSupport] = useState<SerialSupportState>({
    hasSerialApi: false,
    isSecureContext: false,
    isSupported: false,
    isDetected: false,
    reason: null,
  });

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const pendingLinesRef = useRef<PendingLine[]>([]);
  const lineQueueRef = useRef<string[]>([]);
  const textBufferRef = useRef("");
  const connectedFlagRef = useRef(false);

  const encoderRef = useRef(new TextEncoder());
  const decoderRef = useRef(new TextDecoder());

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") {
      return;
    }

    const serialNav = navigator as NavigatorWithSerial;
    const hasSerialApi = Boolean(serialNav.serial);
    const isSecureContext = window.isSecureContext;
    const isSupported = hasSerialApi && isSecureContext;

    if (isSupported) {
      setSerialSupport({
        hasSerialApi,
        isSecureContext,
        isSupported,
        isDetected: true,
        reason: null,
      });
      return;
    }

    setSerialSupport({
      hasSerialApi,
      isSecureContext,
      isSupported,
      isDetected: true,
      reason: !isSecureContext
        ? "Страница открыта в небезопасном контексте. Нужен HTTPS или localhost."
        : "Браузер не предоставляет WebSerial API (или API заблокирован политиками).",
    });
  }, []);

  const rejectPendingLines = useCallback((message: string) => {
    const pending = pendingLinesRef.current.splice(0, pendingLinesRef.current.length);
    for (const item of pending) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
  }, []);

  const disconnect = useCallback(async () => {
    connectedFlagRef.current = false;

    const reader = readerRef.current;
    readerRef.current = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // no-op
      }
      try {
        reader.releaseLock();
      } catch {
        // no-op
      }
    }

    const writer = writerRef.current;
    writerRef.current = null;
    if (writer) {
      try {
        writer.releaseLock();
      } catch {
        // no-op
      }
    }

    const port = portRef.current;
    portRef.current = null;
    if (port) {
      try {
        await port.close();
      } catch {
        // no-op
      }
    }

    textBufferRef.current = "";
    lineQueueRef.current = [];
    rejectPendingLines("Disconnected");
    setConnected(false);
  }, [rejectPendingLines]);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }
    const serialNav = navigator as NavigatorWithSerial;
    if (!serialNav.serial?.addEventListener || !serialNav.serial?.removeEventListener) {
      return;
    }

    const handleSerialDisconnect: EventListener = () => {
      if (connectedFlagRef.current) {
        void disconnect();
      }
    };

    serialNav.serial.addEventListener("disconnect", handleSerialDisconnect);
    return () => {
      serialNav.serial?.removeEventListener?.("disconnect", handleSerialDisconnect);
    };
  }, [disconnect]);

  const pushIncomingLine = useCallback(
    (line: string) => {
      const pending = pendingLinesRef.current.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(line);
      } else {
        lineQueueRef.current.push(line);
      }
    },
    [],
  );

  const isConnectionLostError = useCallback((error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return (
      message.includes("device has been lost") ||
      message.includes("networkerror") ||
      message.includes("port is closed") ||
      message.includes("disconnected") ||
      message.includes("cannot read from a closed port") ||
      message.includes("cannot write to a closed port")
    );
  }, []);

  const readLoop = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader) {
      return;
    }

    try {
      while (connectedFlagRef.current) {
        const { done, value } = await reader.read();
        if (done) {
          if (connectedFlagRef.current) {
            await disconnect();
          }
          break;
        }

        if (!value || value.length === 0) {
          continue;
        }

        textBufferRef.current += decoderRef.current.decode(value, { stream: true });

        while (true) {
          const newlineIndex = textBufferRef.current.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }

          const raw = textBufferRef.current.slice(0, newlineIndex).replace(/\r$/, "");
          textBufferRef.current = textBufferRef.current.slice(newlineIndex + 1);

          const line = raw.trim();
          if (line.length > 0) {
            pushIncomingLine(line);
          }
        }
      }
    } catch (error) {
      if (connectedFlagRef.current) {
        console.error("WebSerial read error", error);
        await disconnect();
      }
    }
  }, [disconnect, pushIncomingLine]);

  const waitForLine = useCallback((timeoutMs = 3500): Promise<string> => {
    if (lineQueueRef.current.length > 0) {
      const line = lineQueueRef.current.shift();
      return Promise.resolve(line ?? "");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingLinesRef.current = pendingLinesRef.current.filter((item) => item !== pendingItem);
        reject(new Error("Timeout waiting for device response"));
      }, timeoutMs);

      const pendingItem: PendingLine = { resolve, reject, timer };
      pendingLinesRef.current.push(pendingItem);
    });
  }, []);

  const sendCommand = useCallback(
    async (command: string): Promise<string> => {
      const writer = writerRef.current;
      if (!writer) {
        throw new Error("Device is not connected");
      }

      try {
        await writer.write(encoderRef.current.encode(`${command}\n`));

        let line = await waitForLine();
        while (line.startsWith("OK READY")) {
          line = await waitForLine();
        }

        if (line.startsWith("ERR")) {
          throw new Error(line);
        }

        if (!line.startsWith("OK")) {
          throw new Error(`Unexpected response: ${line}`);
        }

        return line;
      } catch (error) {
        if (connectedFlagRef.current && isConnectionLostError(error)) {
          await disconnect();
        }
        throw error;
      }
    },
    [disconnect, isConnectionLostError, waitForLine],
  );

  const refreshData = useCallback(async () => {
    await sendCommand("GET_INFO");

    const slotsLine = await sendCommand("LIST_SLOTS");
    const payload = slotsLine.replace(/^OK SLOTS\s*/, "");
    const slotLengths = Array(SLOT_COUNT).fill(0);

    if (payload.length > 0) {
      for (const part of payload.split(",")) {
        const [slotText, lenText] = part.split(":");
        const slot = Number(slotText);
        const length = Number(lenText);
        if (Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT && Number.isInteger(length) && length >= 0) {
          slotLengths[slot - 1] = length;
        }
      }
    }

    const nextSlotPasswords = Array(SLOT_COUNT).fill("");
    for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
      if (slotLengths[slot - 1] <= 0) {
        continue;
      }

      const slotLine = await sendCommand(`GET_SLOT ${slot}`);
      const match = slotLine.match(/^OK SLOT\s+(\d+)(?:\s(.*))?$/);
      const slotFromResponse = Number(match?.[1] ?? slot);
      const password = match?.[2] ?? "";

      if (Number.isInteger(slotFromResponse) && slotFromResponse >= 1 && slotFromResponse <= SLOT_COUNT) {
        nextSlotPasswords[slotFromResponse - 1] = password;
      } else {
        nextSlotPasswords[slot - 1] = password;
      }
    }

    setSlotPasswords(nextSlotPasswords);
    setVisibleSlots((prev) => prev.filter((slot) => nextSlotPasswords[slot - 1].length > 0));
    setEditingSlot((prev) => (prev !== null && nextSlotPasswords[prev - 1].length > 0 ? prev : null));
    setIsAddFormOpen((prev) => prev && nextSlotPasswords.some((password) => password.length === 0));
    setNewSlot((prev) => {
      if (nextSlotPasswords[prev - 1]?.length === 0) {
        return prev;
      }
      const firstFreeIndex = nextSlotPasswords.findIndex((password) => password.length === 0);
      return firstFreeIndex >= 0 ? firstFreeIndex + 1 : 1;
    });
  }, [sendCommand]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        await action();
      } catch (error) {
        console.error("PasswordPad action failed", error);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const connect = useCallback(async () => {
    const serialNav = navigator as NavigatorWithSerial;
    if (!serialNav.serial) {
      throw new Error("WebSerial is not available in this browser");
    }

    const port = await serialNav.serial.requestPort();
    await port.open({ baudRate: 115200 });

    if (!port.readable || !port.writable) {
      await port.close();
      throw new Error("Port does not expose readable/writable streams");
    }

    portRef.current = port;
    readerRef.current = port.readable.getReader();
    writerRef.current = port.writable.getWriter();
    connectedFlagRef.current = true;
    setConnected(true);

    void readLoop();

    // Some boards emit READY after opening serial; a short delay helps consume it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await refreshData();
  }, [readLoop, refreshData]);

  const savePin = useCallback(async () => {
    const pin = pinValue.trim();
    if (!/^([1-6]{1,8}|0)$/.test(pin)) {
      throw new Error("PIN must be 0 (disabled) or digits 1..6 with length 1..8");
    }

    await sendCommand(`SET_PIN ${pin}`);
    await refreshData();
  }, [pinValue, refreshData, sendCommand]);

  const passwordEntries = useMemo(
    () =>
      slotPasswords
        .map((password, index) => ({ slot: index + 1, password }))
        .filter((item) => item.password.length > 0),
    [slotPasswords],
  );

  const freeSlots = useMemo(
    () => slotPasswords.map((password, index) => (password.length === 0 ? index + 1 : null)).filter((slot): slot is number => slot !== null),
    [slotPasswords],
  );

  const hasPasswords = passwordEntries.length > 0;
  const hasFreeSlots = freeSlots.length > 0;

  const openAddForm = useCallback(() => {
    if (!hasFreeSlots) {
      return;
    }
    setEditingSlot(null);
    setEditingPassword("");
    setNewSlot(freeSlots[0]);
    setNewPassword("");
    setIsAddFormOpen(true);
  }, [freeSlots, hasFreeSlots]);

  const cancelAddForm = useCallback(() => {
    setIsAddFormOpen(false);
    setNewPassword("");
  }, []);

  const addPassword = useCallback(async () => {
    if (!freeSlots.includes(newSlot)) {
      throw new Error("Выбранная кнопка уже занята.");
    }
    if (newPassword.length === 0) {
      throw new Error("Пароль не может быть пустым.");
    }
    if (newPassword.length > 48) {
      throw new Error("Максимальная длина пароля: 48 символов.");
    }

    await sendCommand(`SET_SLOT ${newSlot} ${newPassword}`);
    setIsAddFormOpen(false);
    setNewPassword("");
    setVisibleSlots((prev) => (prev.includes(newSlot) ? prev : [...prev, newSlot]));
    await refreshData();
  }, [freeSlots, newPassword, newSlot, refreshData, sendCommand]);

  const startEditing = useCallback((slot: number, password: string) => {
    setIsAddFormOpen(false);
    setEditingSlot(slot);
    setEditingPassword(password);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingSlot(null);
    setEditingPassword("");
  }, []);

  const saveEditing = useCallback(async () => {
    if (editingSlot === null) {
      return;
    }
    if (editingPassword.length === 0) {
      throw new Error("Пароль не может быть пустым.");
    }
    if (editingPassword.length > 48) {
      throw new Error("Максимальная длина пароля: 48 символов.");
    }

    await sendCommand(`SET_SLOT ${editingSlot} ${editingPassword}`);
    setEditingSlot(null);
    setVisibleSlots((prev) => (prev.includes(editingSlot) ? prev : [...prev, editingSlot]));
    await refreshData();
  }, [editingPassword, editingSlot, refreshData, sendCommand]);

  const removePassword = useCallback(
    async (slot: number) => {
      await sendCommand(`CLEAR_SLOT ${slot}`);
      setVisibleSlots((prev) => prev.filter((item) => item !== slot));
      if (editingSlot === slot) {
        setEditingSlot(null);
        setEditingPassword("");
      }
      await refreshData();
    },
    [editingSlot, refreshData, sendCommand],
  );

  const toggleSlotVisibility = useCallback((slot: number) => {
    setVisibleSlots((prev) => (prev.includes(slot) ? prev.filter((item) => item !== slot) : [...prev, slot]));
  }, []);

  const canConnect = !connected && !busy && (!serialSupport.isDetected || serialSupport.isSupported);
  const canUseDevice = connected && !busy;

  const buttonBaseClass =
    "rounded-xl px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const primaryButtonClass = `${buttonBaseClass} bg-slate-900 text-white hover:bg-slate-800`;
  const secondaryButtonClass = `${buttonBaseClass} border border-slate-300 bg-white/70 text-slate-700 hover:bg-white/90`;
  const dangerButtonClass = `${buttonBaseClass} border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100`;
  const actionButtonClass =
    "rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50";
  const actionPrimaryClass =
    "rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
  const actionDangerClass =
    "rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50";
  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100";
  const labelClass = "text-sm font-medium text-slate-700";

  useEffect(() => {
    return () => {
      void disconnect();
    };
  }, [disconnect]);

  return (
    <div className="h-full overflow-auto p-4">
      <div className={`mx-auto ${connected ? "max-w-5xl space-y-4" : "flex min-h-full max-w-3xl items-center justify-center"}`}>
        <section className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${connected ? "" : "w-full max-w-2xl"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Password Pad</h2>
              <p className="mt-1 text-sm text-slate-600">
                Управление устройством через WebSerial. Рекомендуется Chrome/Edge и запуск через HTTPS или localhost.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
              }`}
            >
              {busy ? "Выполняется команда" : connected ? "Подключено" : "Отключено"}
            </span>
          </div>

          {serialSupport.isDetected && !serialSupport.isSupported && serialSupport.reason && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <div className="font-medium">WebSerial недоступен.</div>
              <div className="mt-1">{serialSupport.reason}</div>
              <div className="mt-2 text-xs text-rose-800/80">
                Проверка: secureContext={String(serialSupport.isSecureContext)}, navigator.serial=
                {String(serialSupport.hasSerialApi)}
              </div>
              <div className="mt-1 text-xs text-rose-800/80">
                Если открываете с другого ПК, используйте HTTPS. Адрес `http://192.168.x.x` обычно не подходит.
              </div>
            </div>
          )}

          <div className={`mt-4 flex flex-wrap gap-2 ${connected ? "" : "justify-center"}`}>
            <button
              type="button"
              disabled={!canConnect}
              onClick={() => void runAction(connect)}
              className={primaryButtonClass}
            >
              Подключить
            </button>
            <button
              type="button"
              disabled={!canUseDevice}
              onClick={() => void runAction(disconnect)}
              className={secondaryButtonClass}
            >
              Отключить
            </button>
            <button
              type="button"
              disabled={!canUseDevice}
              onClick={() => void runAction(refreshData)}
              className={secondaryButtonClass}
            >
              Обновить
            </button>
          </div>
        </section>

        {connected && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur-sm">
              <h3 className="text-base font-semibold text-slate-900">PIN</h3>
              <p className="mt-1 text-sm text-slate-600">0 отключает PIN. Иначе только цифры от 1 до 6, длина от 1 до 8.</p>
              <label className={`mt-4 block ${labelClass}`}>
                Новый PIN
                <input
                  value={pinValue}
                  onChange={(event) => setPinValue(event.target.value)}
                  className={inputClass}
                  disabled={!canUseDevice}
                  maxLength={8}
                  inputMode="numeric"
                  placeholder="0 или PIN (1..6)"
                />
              </label>
              <button
                type="button"
                disabled={!canUseDevice}
                onClick={() => void runAction(savePin)}
                className={`${primaryButtonClass} mt-4`}
              >
                Сохранить PIN
              </button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Пароли по кнопкам</h3>
                  <p className="mt-1 text-sm text-slate-600">Максимум {SLOT_COUNT} слотов, до 48 символов на пароль.</p>
                </div>
                <div className="text-xs text-slate-500">
                  Заполнено: {passwordEntries.length}/{SLOT_COUNT}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {passwordEntries.map((item) => {
                  const isEditing = editingSlot === item.slot;
                  const isVisible = visibleSlots.includes(item.slot);

                  return (
                    <div key={item.slot} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900">Кнопка {item.slot}</div>
                          {isEditing ? (
                            <div className="mt-2">
                              <input
                                value={editingPassword}
                                onChange={(event) => setEditingPassword(event.target.value)}
                                className={inputClass}
                                disabled={!canUseDevice}
                                maxLength={48}
                                placeholder="Пароль"
                              />
                              <div className="mt-1 text-xs text-slate-500">{editingPassword.length} / 48</div>
                            </div>
                          ) : (
                            <div className="mt-1 break-all font-mono text-sm text-slate-800">
                              {isVisible ? item.password : "•".repeat(Math.min(item.password.length, 16))}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                disabled={!canUseDevice}
                                onClick={() => void runAction(saveEditing)}
                                className={actionPrimaryClass}
                              >
                                Сохранить
                              </button>
                              <button
                                type="button"
                                disabled={!canUseDevice}
                                onClick={cancelEditing}
                                className={actionButtonClass}
                              >
                                Отмена
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={!canUseDevice}
                                onClick={() => toggleSlotVisibility(item.slot)}
                                className={actionButtonClass}
                              >
                                {isVisible ? "Скрыть" : "Показать"}
                              </button>
                              <button
                                type="button"
                                disabled={!canUseDevice}
                                onClick={() => startEditing(item.slot, item.password)}
                                className={actionButtonClass}
                              >
                                Редактировать
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            disabled={!canUseDevice}
                            onClick={() => void runAction(() => removePassword(item.slot))}
                            className={actionDangerClass}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!hasPasswords && !isAddFormOpen && (
                  <button
                    type="button"
                    disabled={!canUseDevice || !hasFreeSlots}
                    onClick={openAddForm}
                    className={primaryButtonClass}
                  >
                    Добавить пароль
                  </button>
                )}

                {hasPasswords && !isAddFormOpen && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={!canUseDevice || !hasFreeSlots}
                      onClick={openAddForm}
                      className={primaryButtonClass}
                    >
                      Добавить пароль
                    </button>
                    {!hasFreeSlots && <span className="text-sm text-slate-500">Свободных кнопок нет.</span>}
                  </div>
                )}

                {isAddFormOpen && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className={`block ${labelClass}`}>
                        Кнопка
                        <select
                          value={newSlot}
                          onChange={(event) => setNewSlot(Number(event.target.value))}
                          className={inputClass}
                          disabled={!canUseDevice}
                        >
                          {freeSlots.map((slot) => (
                            <option key={slot} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={`block sm:col-span-2 ${labelClass}`}>
                        Пароль
                        <input
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          className={inputClass}
                          disabled={!canUseDevice}
                          maxLength={48}
                          placeholder="Пароль"
                        />
                      </label>
                    </div>

                    <div className="mt-1 text-xs text-slate-500">{newPassword.length} / 48</div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canUseDevice || !hasFreeSlots}
                        onClick={() => void runAction(addPassword)}
                        className={actionPrimaryClass}
                      >
                        Сохранить пароль
                      </button>
                      <button
                        type="button"
                        disabled={!canUseDevice}
                        onClick={cancelAddForm}
                        className={actionButtonClass}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-rose-200 bg-rose-50/40">
              <details>
                <summary className="cursor-pointer px-4 py-3 text-base font-semibold text-rose-800">
                  Опасные действия
                </summary>
                <div className="border-t border-rose-200 px-4 py-4">
                  <p className="text-sm text-rose-700">
                    Используйте только если понимаете последствия. Команды выполняются сразу на устройстве.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canUseDevice}
                      onClick={() => void runAction(async () => sendCommand("LOCK").then(() => refreshData()))}
                      className={dangerButtonClass}
                      title="Блокирует устройство: ввод паролей с устройства станет недоступен до разблокировки."
                    >
                      Lock Device
                    </button>
                    <button
                      type="button"
                      disabled={!canUseDevice}
                      onClick={() => void runAction(async () => sendCommand("CLEAR_ALL").then(() => refreshData()))}
                      className={dangerButtonClass}
                      title="Удаляет все сохраненные пароли во всех кнопках (слотах)."
                    >
                      Clear All Slots
                    </button>
                    <button
                      type="button"
                      disabled={!canUseDevice}
                      onClick={() =>
                        void runAction(async () => {
                          await sendCommand("FACTORY_RESET");
                          setPinValue("0");
                          setSlotPasswords(Array(SLOT_COUNT).fill(""));
                          setVisibleSlots([]);
                          setEditingSlot(null);
                          setEditingPassword("");
                          setIsAddFormOpen(false);
                          setNewPassword("");
                          await refreshData();
                        })
                      }
                      className={dangerButtonClass}
                      title="Полный сброс устройства к заводским настройкам: очищает пароли и PIN."
                    >
                      Factory Reset
                    </button>
                  </div>
                </div>
              </details>
            </section>

          </>
        )}
      </div>
    </div>
  );
}
