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
  };
}

type PendingLine = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const SLOT_COUNT = 6;
const MAX_LOG_LINES = 80;

export default function PasswordPadAdminPage() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState("-");
  const [storedCount, setStoredCount] = useState(0);
  const [slotLengths, setSlotLengths] = useState<number[]>(Array(SLOT_COUNT).fill(0));
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [slotValue, setSlotValue] = useState("");
  const [pinValue, setPinValue] = useState("1234");
  const [logLines, setLogLines] = useState<string[]>([]);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const pendingLinesRef = useRef<PendingLine[]>([]);
  const lineQueueRef = useRef<string[]>([]);
  const textBufferRef = useRef("");
  const connectedFlagRef = useRef(false);

  const encoderRef = useRef(new TextEncoder());
  const decoderRef = useRef(new TextDecoder());

  const isWebSerialSupported = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    const serialNav = navigator as NavigatorWithSerial;
    return Boolean(serialNav.serial);
  }, []);

  const appendLog = useCallback((line: string) => {
    setLogLines((prev) => {
      const next = [...prev, line];
      return next.slice(-MAX_LOG_LINES);
    });
  }, []);

  const rejectPendingLines = useCallback((message: string) => {
    const pending = pendingLinesRef.current.splice(0, pendingLinesRef.current.length);
    for (const item of pending) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
  }, []);

  const pushIncomingLine = useCallback(
    (line: string) => {
      appendLog(`< ${line}`);
      const pending = pendingLinesRef.current.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(line);
      } else {
        lineQueueRef.current.push(line);
      }
    },
    [appendLog],
  );

  const readLoop = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader) {
      return;
    }

    try {
      while (connectedFlagRef.current) {
        const { done, value } = await reader.read();
        if (done) {
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
        appendLog(`! read error: ${(error as Error).message}`);
      }
    }
  }, [appendLog, pushIncomingLine]);

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

      appendLog(`> ${command}`);
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
    },
    [appendLog, waitForLine],
  );

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

  const refreshData = useCallback(async () => {
    const infoLine = await sendCommand("GET_INFO");
    setDeviceInfo(infoLine.replace(/^OK INFO\s*/, ""));

    const countLine = await sendCommand("GET_COUNT");
    const countMatch = countLine.match(/^OK COUNT\s+(\d+)$/);
    setStoredCount(countMatch ? Number(countMatch[1]) : 0);

    const slotsLine = await sendCommand("LIST_SLOTS");
    const payload = slotsLine.replace(/^OK SLOTS\s*/, "");
    const parsed = Array(SLOT_COUNT).fill(0);

    for (const part of payload.split(",")) {
      const [slotText, lenText] = part.split(":");
      const slot = Number(slotText);
      const length = Number(lenText);
      if (Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT && Number.isInteger(length) && length >= 0) {
        parsed[slot - 1] = length;
      }
    }

    setSlotLengths(parsed);
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
        appendLog(`! ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [appendLog, busy],
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

    appendLog("* connected");
    void readLoop();

    // Some boards emit READY after opening serial; a short delay helps consume it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await refreshData();
  }, [appendLog, readLoop, refreshData]);

  const saveSlot = useCallback(async () => {
    await sendCommand(`SET_SLOT ${selectedSlot} ${slotValue}`);
    await refreshData();
  }, [refreshData, selectedSlot, sendCommand, slotValue]);

  const loadSlot = useCallback(async () => {
    const line = await sendCommand(`GET_SLOT ${selectedSlot}`);
    const match = line.match(/^OK SLOT\s+\d+(?:\s(.*))?$/);
    setSlotValue(match?.[1] ?? "");
  }, [selectedSlot, sendCommand]);

  const clearSlot = useCallback(async () => {
    await sendCommand(`CLEAR_SLOT ${selectedSlot}`);
    setSlotValue("");
    await refreshData();
  }, [refreshData, selectedSlot, sendCommand]);

  const savePin = useCallback(async () => {
    const pin = pinValue.trim();
    if (!/^([1-6]{1,8})$/.test(pin)) {
      throw new Error("PIN must contain only digits 1..6 and length 1..8");
    }

    await sendCommand(`SET_PIN ${pin}`);
    await refreshData();
  }, [pinValue, refreshData, sendCommand]);

  const filledSlots = useMemo(() => slotLengths.filter((length) => length > 0).length, [slotLengths]);
  const slotLengthsLabel = useMemo(
    () => slotLengths.map((length, index) => `${index + 1}:${length}`).join(" | "),
    [slotLengths],
  );
  const canConnect = isWebSerialSupported && !connected && !busy;
  const canUseDevice = connected && !busy;

  const buttonBaseClass =
    "rounded-xl px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const primaryButtonClass = `${buttonBaseClass} bg-slate-900 text-white hover:bg-slate-800`;
  const secondaryButtonClass = `${buttonBaseClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;
  const dangerButtonClass = `${buttonBaseClass} border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100`;
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
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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

          {!isWebSerialSupported && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              В этом браузере нет поддержки WebSerial.
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
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

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Статус</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{connected ? "Connected" : "Disconnected"}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Device info</div>
            <div className="mt-1 break-all font-mono text-sm text-slate-900">{deviceInfo || "-"}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Пароли</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{storedCount}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2 xl:col-span-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Слоты</div>
            <div className="mt-1 text-sm text-slate-900">
              Заполнено: <span className="font-semibold">{filledSlots}</span> из {SLOT_COUNT}
            </div>
            <div className="mt-1 text-xs text-slate-600">{slotLengthsLabel}</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-900">PIN</h3>
            <p className="mt-1 text-sm text-slate-600">Только цифры от 1 до 6, длина от 1 до 8.</p>
            <label className={`mt-4 block ${labelClass}`}>
              Новый PIN
              <input
                value={pinValue}
                onChange={(event) => setPinValue(event.target.value)}
                className={inputClass}
                disabled={!canUseDevice}
                maxLength={8}
                inputMode="numeric"
                placeholder="1234"
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
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-900">Слот пароля</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className={`block ${labelClass}`}>
                Слот
                <select
                  value={selectedSlot}
                  onChange={(event) => setSelectedSlot(Number(event.target.value))}
                  className={inputClass}
                  disabled={!canUseDevice}
                >
                  {Array.from({ length: SLOT_COUNT }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`block sm:col-span-2 ${labelClass}`}>
                Пароль
                <input
                  value={slotValue}
                  onChange={(event) => setSlotValue(event.target.value)}
                  className={inputClass}
                  disabled={!canUseDevice}
                  placeholder="max 48 printable ASCII chars"
                  maxLength={48}
                />
              </label>
            </div>

            <div className="mt-1 text-xs text-slate-500">Длина текущего значения: {slotValue.length} / 48</div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canUseDevice}
                onClick={() => void runAction(loadSlot)}
                className={secondaryButtonClass}
              >
                Загрузить
              </button>
              <button
                type="button"
                disabled={!canUseDevice}
                onClick={() => void runAction(saveSlot)}
                className={primaryButtonClass}
              >
                Сохранить
              </button>
              <button
                type="button"
                disabled={!canUseDevice}
                onClick={() => void runAction(clearSlot)}
                className={secondaryButtonClass}
              >
                Очистить
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
          <h3 className="text-base font-semibold text-rose-800">Опасные действия</h3>
          <p className="mt-1 text-sm text-rose-700">
            Используйте только если понимаете последствия. Команды выполняются сразу на устройстве.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canUseDevice}
              onClick={() => void runAction(async () => sendCommand("LOCK").then(() => refreshData()))}
              className={dangerButtonClass}
            >
              Lock Device
            </button>
            <button
              type="button"
              disabled={!canUseDevice}
              onClick={() => void runAction(async () => sendCommand("CLEAR_ALL").then(() => refreshData()))}
              className={dangerButtonClass}
            >
              Clear All Slots
            </button>
            <button
              type="button"
              disabled={!canUseDevice}
              onClick={() =>
                void runAction(async () => {
                  await sendCommand("FACTORY_RESET");
                  setPinValue("1234");
                  setSlotValue("");
                  await refreshData();
                })
              }
              className={dangerButtonClass}
            >
              Factory Reset
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Лог обмена</h3>
            <button
              type="button"
              onClick={() => setLogLines([])}
              disabled={logLines.length === 0}
              className={secondaryButtonClass}
            >
              Очистить лог
            </button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
            {logLines.length > 0 ? logLines.join("\n") : "No messages yet"}
          </pre>
        </section>
      </div>
    </div>
  );
}
