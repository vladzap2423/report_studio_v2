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
      return next.slice(-12);
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

  useEffect(() => {
    return () => {
      void disconnect();
    };
  }, [disconnect]);

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Password Pad Admin</h1>
      <p style={{ marginTop: 0, color: "#444" }}>
        Browser talks to Pro Micro over WebSerial. Use Chrome/Edge and open via HTTPS or localhost.
      </p>

      {!isWebSerialSupported && (
        <p style={{ color: "#b00020", fontWeight: 600 }}>WebSerial is not supported in this browser.</p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <button disabled={!isWebSerialSupported || connected || busy} onClick={() => void runAction(connect)}>
          Connect
        </button>
        <button disabled={!connected || busy} onClick={() => void runAction(disconnect)}>
          Disconnect
        </button>
        <button disabled={!connected || busy} onClick={() => void runAction(refreshData)}>
          Refresh
        </button>
      </div>

      <section style={{ marginBottom: 20 }}>
        <div>
          <strong>Status:</strong> {connected ? "Connected" : "Disconnected"}
        </div>
        <div>
          <strong>Device info:</strong> {deviceInfo}
        </div>
        <div>
          <strong>Stored passwords:</strong> {storedCount}
        </div>
        <div>
          <strong>Slot lengths:</strong> {slotLengths.map((len, i) => `${i + 1}:${len}`).join(", ")}
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>PIN</h2>
          <label style={{ display: "block", marginBottom: 8 }}>
            New PIN (digits 1..6)
            <input
              value={pinValue}
              onChange={(event) => setPinValue(event.target.value)}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!connected || busy}
            />
          </label>
          <button disabled={!connected || busy} onClick={() => void runAction(savePin)}>
            Save PIN
          </button>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>Slot</h2>
          <label style={{ display: "block", marginBottom: 8 }}>
            Slot
            <select
              value={selectedSlot}
              onChange={(event) => setSelectedSlot(Number(event.target.value))}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!connected || busy}
            >
              {Array.from({ length: SLOT_COUNT }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "block", marginBottom: 8 }}>
            Password
            <input
              value={slotValue}
              onChange={(event) => setSlotValue(event.target.value)}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!connected || busy}
              placeholder="max 48 printable ASCII chars"
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!connected || busy} onClick={() => void runAction(loadSlot)}>
              Load
            </button>
            <button disabled={!connected || busy} onClick={() => void runAction(saveSlot)}>
              Save
            </button>
            <button disabled={!connected || busy} onClick={() => void runAction(clearSlot)}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button disabled={!connected || busy} onClick={() => void runAction(async () => sendCommand("LOCK").then(() => refreshData()))}>
          Lock Device
        </button>
        <button disabled={!connected || busy} onClick={() => void runAction(async () => sendCommand("CLEAR_ALL").then(() => refreshData()))}>
          Clear All Slots
        </button>
        <button
          disabled={!connected || busy}
          onClick={() =>
            void runAction(async () => {
              await sendCommand("FACTORY_RESET");
              setPinValue("1234");
              setSlotValue("");
              await refreshData();
            })
          }
        >
          Factory Reset
        </button>
      </section>

      <section>
        <h2 style={{ marginBottom: 8 }}>Log</h2>
        <pre
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 8,
            background: "#111",
            color: "#e5e5e5",
            minHeight: 120,
            overflowX: "auto",
          }}
        >
          {logLines.length > 0 ? logLines.join("\n") : "No messages yet"}
        </pre>
      </section>
    </main>
  );
}
