import { useEffect, useRef, useState, useCallback } from 'react';
import { authFetch, authenticatedWsUrl } from "./auth";
import { apiUrl } from "./backend";

export interface TerminalOutput {
  type: 'stdout' | 'stderr' | 'info' | 'success' | 'error';
  content: string;
}

interface TerminalSocketMessage {
  type: string;
  data?: string;
  content?: string;
  port?: string;
  exit_code?: number;
}

export function useTerminalSocket(projectId: string) {
  const [output, setOutput] = useState<TerminalOutput[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [detectedPort, setDetectedPort] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const retriesRef = useRef(0);
  const closedIntentionallyRef = useRef(false);

  const onTerminalData = useCallback((msg: TerminalSocketMessage) => {
    if (msg.type === 'terminal_output') {
      setOutput(prev => [...prev.slice(-300), { type: 'stdout', content: msg.data ?? '' }]);
    } else if (msg.type === 'process_started') {
      setIsRunning(true);
      setDetectedPort(null);
      setOutput(prev => [...prev.slice(-300), { type: 'info', content: 'Process started...' }]);
    } else if (msg.type === 'terminal_done') {
      setIsRunning(false);
      const type = msg.exit_code === 0 ? 'success' : 'error';
      setOutput(prev => [...prev.slice(-300), {
        type,
        content: msg.exit_code === 0 ? 'Process completed.' : `Process failed (Code ${msg.exit_code})`
      }]);
    } else if (msg.type === 'server_started') {
      setDetectedPort(msg.port ?? null);
      setOutput(prev => [...prev.slice(-300), { type: 'success', content: `Server live on port ${msg.port ?? ''}` }]);
    } else if (msg.type === 'error') {
      setOutput(prev => [...prev.slice(-300), { type: 'error', content: msg.data || msg.content || '' }]);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!projectId) return;

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Health Check
    try {
      const res = await authFetch(apiUrl('/api/health'));
      if (!res.ok) throw new Error();
    } catch {
      console.log("[Terminal] Backend not ready");
      const maxRetries = 5;
      if (retriesRef.current < maxRetries) {
        retriesRef.current++;
        reconnectTimerRef.current = window.setTimeout(connect, 5000);
      }
      return;
    }

    const path = `/ws/projects/${projectId}/terminal`;
    console.log(`[Terminal] Connecting to ${path}`);

    try {
      const finalUrl = await authenticatedWsUrl(path);
      const ws = new WebSocket(finalUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        retriesRef.current = 0;
        setError(null);
        authFetch(apiUrl(`/api/projects/${projectId}/terminal/status`))
          .then(res => res.json())
          .then(data => { if (data.running) setIsRunning(true); })
          .catch(() => { });
      };

      ws.onmessage = (event) => {
        try {
          onTerminalData(JSON.parse(event.data));
        } catch {
          console.error('[Terminal] Parse error');
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (!closedIntentionallyRef.current) {
          const maxRetries = 5;
          if (retriesRef.current < maxRetries) {
            retriesRef.current++;
            reconnectTimerRef.current = window.setTimeout(connect, 5000);
          }
        }
      };

      ws.onerror = () => {
        setError('Terminal connection failed');
      };
    } catch (e) {
      console.error('[Terminal] Init failed:', e);
    }
  }, [projectId, onTerminalData]);

  useEffect(() => {
    closedIntentionallyRef.current = false;
    connect();
    return () => {
      closedIntentionallyRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command }));
    }
  };

  const killProcess = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'kill' }));
    }
  };

  return {
    output,
    isConnected,
    isRunning,
    detectedPort,
    error,
    sendCommand,
    killProcess,
    clearOutput: () => setOutput([])
  };
}
