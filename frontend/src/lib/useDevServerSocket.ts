import { useEffect, useRef, useState, useCallback } from 'react';
import { authenticatedWsUrl } from "./auth";
import { apiUrl } from "./backend";

interface DevServerEvent {
    type: 'log' | 'started' | 'stopped' | 'error';
    data?: string;
    port?: string;
    message?: string;
    exit_code?: number;
}

export function useDevServerSocket(projectId: string | undefined) {
    const [logs, setLogs] = useState<string[]>([]);
    const [port, setPort] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | undefined>(undefined);
    const retriesRef = useRef(0);
    const closedIntentionallyRef = useRef(false);
    const pendingActionRef = useRef<'start' | 'stop' | 'restart' | null>(null);

    const connect = useCallback(async () => {
        try {
            if (!projectId) return;

            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
                return;
            }

            // Health Check
            try {
                const res = await fetch(apiUrl('/api/health'));
                if (!res.ok) throw new Error();
            } catch {
                console.log("[DevServer] Backend not ready");
                const maxRetries = 5;
                if (retriesRef.current < maxRetries) {
                    retriesRef.current++;
                    reconnectTimerRef.current = window.setTimeout(() => {
                        void connect();
                    }, 5000);
                }
                return;
            }

            const path = `/ws/projects/${projectId}/devserver`;
            const wsUrl = await authenticatedWsUrl(path);
            console.log(`[DevServer] Connecting to ${path}`);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                setError(null);
                retriesRef.current = 0;
                if (pendingActionRef.current) {
                    ws.send(JSON.stringify({ action: pendingActionRef.current }));
                    pendingActionRef.current = null;
                }
            };

            ws.onmessage = (event) => {
                try {
                    const data: DevServerEvent = JSON.parse(event.data);
                    switch (data.type) {
                        case 'log':
                            {
                                const logLine = data.data;
                                if (!logLine) break;
                                setLogs(prev => [...prev, logLine].slice(-200));
                            }
                            break;
                        case 'started':
                            setPort(data.port || null);
                            setIsRunning(true);
                            setIsStarting(false);
                            break;
                        case 'stopped':
                            setIsRunning(false);
                            setIsStarting(false);
                            setPort(null);
                            break;
                        case 'error':
                            setError(data.message || 'Unknown error');
                            setIsStarting(false);
                            break;
                    }
                } catch (e) {
                    console.error('[DevServer] Parse error:', e);
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                wsRef.current = null;
                if (!closedIntentionallyRef.current) {
                    const maxRetries = 5;
                    if (retriesRef.current < maxRetries) {
                        retriesRef.current++;
                        reconnectTimerRef.current = window.setTimeout(() => {
                            void connect();
                        }, 5000);
                    }
                }
            };

            ws.onerror = () => {
                setError('WebSocket connection error');
            };
        } catch (error) {
            console.error('[DevServer] Init failed:', error);
            setError('Failed to connect dev server socket');
        }
    }, [projectId]);

    useEffect(() => {
        closedIntentionallyRef.current = false;
        void connect();
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

    const startServer = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            setLogs([]);
            setIsStarting(true);
            wsRef.current.send(JSON.stringify({ action: 'start' }));
            return;
        }
        setLogs([]);
        setIsStarting(true);
        pendingActionRef.current = 'start';
        void connect();
    };

    const stopServer = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'stop' }));
            return;
        }
        pendingActionRef.current = 'stop';
        void connect();
    };

    const restartServer = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            setLogs([]);
            setIsStarting(true);
            wsRef.current.send(JSON.stringify({ action: 'restart' }));
            return;
        }
        setLogs([]);
        setIsStarting(true);
        pendingActionRef.current = 'restart';
        void connect();
    };

    return {
        logs,
        port,
        isRunning,
        isStarting,
        error,
        isConnected,
        startServer,
        stopServer,
        restartServer,
        clearLogs: () => setLogs([])
    };
}
