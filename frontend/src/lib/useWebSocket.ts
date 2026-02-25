import { useEffect, useRef, useState } from "react";
import { authenticatedWsUrl } from "./auth";
import { apiUrl } from "./backend";

interface UseWebSocketOptions {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxRetries?: number;
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!url) return;

    let closed = false;
    let retries = 0;
    let reconnectTimer: number | undefined;

    const checkHealth = async () => {
      try {
        const res = await fetch(apiUrl("/api/health"), {
          method: "GET",
          credentials: "include",
        });

        if (res.ok) {
          setBackendReady(true);
          return true;
        }
      } catch {
        // Ignore transient connection errors.
      }
      setBackendReady(false);
      return false;
    };

    const scheduleReconnect = () => {
      const maxRetries = optionsRef.current.maxRetries ?? 5;
      const delay = optionsRef.current.reconnectInterval ?? 5000;
      if (closed || retries >= maxRetries) return;
      retries += 1;
      setReconnecting(true);
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (closed) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const isReady = await checkHealth();
      if (!isReady) {
        scheduleReconnect();
        return;
      }

      let finalUrl = url;
      if (finalUrl.includes("/ws/projects/")) {
        const pathIndex = finalUrl.indexOf("/ws/projects/");
        const path = finalUrl.substring(pathIndex);
        finalUrl = await authenticatedWsUrl(path);
      }

      try {
        const ws = new WebSocket(finalUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          retries = 0;
          setConnected(true);
          setReconnecting(false);
          optionsRef.current.onOpen?.();
        };

        ws.onmessage = (event) => {
          try {
            optionsRef.current.onMessage(JSON.parse(event.data));
          } catch {
            optionsRef.current.onMessage(event.data);
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          optionsRef.current.onClose?.();
          if (!closed) {
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          setConnected(false);
          optionsRef.current.onError?.(new Event("error"));
        };
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [url]);

  const send = (data: unknown): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  };

  return { send, connected, reconnecting, backendReady };
}
