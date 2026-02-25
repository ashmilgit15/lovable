import { useEffect, useRef, useState, useCallback } from 'react';
import { authFetch, authenticatedWsUrl } from "./auth";
import { apiUrl } from "./backend";

interface DevServerEvent {
    type: 'log' | 'started' | 'stopped' | 'error';
    data?: string;
    port?: string;
    message?: string;
    exit_code?: number;
}

interface DevServerStatusResponse {
    running: boolean;
    port: string | number | null;
    disabled?: boolean;
}

export function useDevServerSocket(projectId: string | undefined) {
    const [logs, setLogs] = useState<string[]>([]);
    const [port, setPort] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isDisabled, setIsDisabled] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | undefined>(undefined);
    const retriesRef = useRef(0);
    const closedIntentionallyRef = useRef(false);
    const pendingActionRef = useRef<'start' | 'stop' | 'restart' | null>(null);
    const disabledRef = useRef(false);

    const markDevServerDisabled = useCallback(() => {
        disabledRef.current = true;
        setIsDisabled(true);
        setIsConnected(false);
        setIsRunning(false);
        setIsStarting(false);
        setPort(null);
        setError('Dev server is disabled on this deployment.');
        pendingActionRef.current = null;
        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = undefined;
        }
    }, []);

    const connect = useCallback(async () => {
        try {
            if (!projectId || disabledRef.current) return;

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

            const statusRes = await authFetch(
                apiUrl(`/api/projects/${projectId}/devserver/status`),
                { cache: "no-store" }
            );
            if (statusRes.ok) {
                const status = await statusRes.json() as DevServerStatusResponse;
                if (status.disabled) {
                    markDevServerDisabled();
                    return;
                }
                setIsRunning(Boolean(status.running));
                setPort(status.running && status.port !== null ? String(status.port) : null);
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

            ws.onclose = (event) => {
                setIsConnected(false);
                wsRef.current = null;
                if (event.code === 4403) {
                    markDevServerDisabled();
                    return;
                }
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
                if (!disabledRef.current) {
                    setError('WebSocket connection error');
                }
            };
        } catch (error) {
            console.error('[DevServer] Init failed:', error);
            if (!disabledRef.current) {
                setError('Failed to connect dev server socket');
            }
        }
    }, [markDevServerDisabled, projectId]);

    useEffect(() => {
        disabledRef.current = false;
        setIsDisabled(false);
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
        if (disabledRef.current) {
            markDevServerDisabled();
            return;
        }
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
        if (disabledRef.current) {
            markDevServerDisabled();
            return;
        }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'stop' }));
            return;
        }
        pendingActionRef.current = 'stop';
        void connect();
    };

    const restartServer = () => {
        if (disabledRef.current) {
            markDevServerDisabled();
            return;
        }
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
        isDisabled,
        startServer,
        stopServer,
        restartServer,
        clearLogs: () => setLogs([])
    };
}
