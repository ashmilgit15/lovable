import { useEffect, useRef } from "react";

interface RuntimeErrorPayload {
  level?: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

export function useConsoleMonitor(
  onRuntimeError: (payload: RuntimeErrorPayload) => void
) {
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "forge-preview") return;
      if (data.type !== "runtime-error") return;

      const payload = data.payload as RuntimeErrorPayload;
      if (!payload?.message) return;

      const key = `${payload.message}:${payload.source || ""}:${payload.line || 0}`;
      const now = Date.now();
      const lastSeen = seenRef.current.get(key) || 0;

      // Dedupe repeated runtime spam for 15 seconds.
      if (now - lastSeen < 15000) return;
      seenRef.current.set(key, now);

      onRuntimeError(payload);
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onRuntimeError]);
}
