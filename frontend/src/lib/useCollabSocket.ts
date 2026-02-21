import { useEffect, useMemo, useRef, useState } from "react";
import { authenticatedWsUrl } from "./auth";

export type CollabUser = {
  id: string;
  username: string;
  color: string;
  is_owner: boolean;
};

export type CollabCursor = {
  position?: number;
};

export type CollabSuggestion = {
  id: string;
  user_id: string;
  username: string;
  message: string;
  timestamp: string;
};

export type CollabChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  model_used?: string | null;
};

interface UseCollabSocketOptions {
  onFileUpdate?: (filename: string, content: string, fromUser: string) => void;
  onChatMessage?: (message: CollabChatMessage, fromUser: string) => void;
  onSuggestionApproved?: (suggestion: CollabSuggestion) => void;
}

function getOrCreateIdentity() {
  const storedId = localStorage.getItem("forge_user_id");
  const userId = storedId || crypto.randomUUID();
  if (!storedId) {
    localStorage.setItem("forge_user_id", userId);
  }

  const storedName = localStorage.getItem("forge_username");
  const username = storedName || `User-${userId.slice(0, 4)}`;
  if (!storedName) {
    localStorage.setItem("forge_username", username);
  }

  return { userId, username };
}

type IncomingPayload = {
  type?: string;
  [key: string]: unknown;
};

export function useCollabSocket(
  projectId: string | undefined,
  options: UseCollabSocketOptions = {}
) {
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [suggestions, setSuggestions] = useState<CollabSuggestion[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Record<string, CollabCursor>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  const identity = useMemo(() => getOrCreateIdentity(), []);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!projectId) return;

    let closed = false;
    let retries = 0;
    let reconnectTimer: number | undefined;

    const scheduleReconnect = () => {
      if (closed || retries >= 5) return;
      retries += 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, 3000);
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

      const path = `/api/collab/ws/${projectId}?username=${encodeURIComponent(
        identity.username
      )}&user_id=${encodeURIComponent(identity.userId)}`;

      try {
        const finalUrl = await authenticatedWsUrl(path);
        const ws = new WebSocket(finalUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          retries = 0;
          setConnected(true);
        };

        ws.onmessage = (event) => {
          let payload: IncomingPayload;
          try {
            payload = JSON.parse(event.data) as IncomingPayload;
          } catch {
            return;
          }

          switch (payload.type) {
            case "joined": {
              const roomInfo = payload.room_info as
                | { owner_id?: string; users?: CollabUser[]; suggestions?: CollabSuggestion[] }
                | undefined;
              setUserId((payload.user_id as string) || null);
              setOwnerId(roomInfo?.owner_id || null);
              setUsers(roomInfo?.users || []);
              setSuggestions(roomInfo?.suggestions || []);
              break;
            }
            case "user_joined": {
              const nextUser = payload.user as CollabUser;
              if (!nextUser) return;
              setUsers((prev) =>
                [...prev, nextUser].filter(
                  (value, index, arr) =>
                    arr.findIndex((item) => item.id === value.id) === index
                )
              );
              break;
            }
            case "user_left": {
              const leftUserId = payload.user_id as string;
              setUsers((prev) => prev.filter((user) => user.id !== leftUserId));
              setCursors((prev) => {
                const next = { ...prev };
                delete next[leftUserId];
                return next;
              });
              break;
            }
            case "owner_changed": {
              setOwnerId((payload.owner_id as string) || null);
              if (Array.isArray(payload.users)) {
                setUsers(payload.users as CollabUser[]);
              }
              break;
            }
            case "file_update":
              optionsRef.current.onFileUpdate?.(
                (payload.filename as string) || "",
                (payload.content as string) || "",
                (payload.from_user as string) || ""
              );
              break;
            case "chat_message":
              optionsRef.current.onChatMessage?.(
                payload.message as CollabChatMessage,
                (payload.from_user as string) || ""
              );
              break;
            case "cursor_update":
              setCursors((prev) => ({
                ...prev,
                [(payload.user_id as string) || ""]: (payload.cursor ||
                  {}) as CollabCursor,
              }));
              break;
            case "new_suggestion":
              setSuggestions((prev) => [...prev, payload.suggestion as CollabSuggestion]);
              break;
            case "suggestion_removed":
              setSuggestions((prev) =>
                prev.filter((item) => item.id !== (payload.suggestion_id as string))
              );
              break;
            case "suggestion_approved": {
              const suggestion = payload.suggestion as CollabSuggestion | undefined;
              setSuggestions((prev) =>
                prev.filter((item) => item.id !== suggestion?.id)
              );
              if (suggestion) {
                optionsRef.current.onSuggestionApproved?.(suggestion);
              }
              break;
            }
            default:
              break;
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (!closed) {
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          setConnected(false);
        };
      } catch {
        setConnected(false);
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
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [projectId, identity.userId, identity.username]);

  const send = (payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  };

  const sendSuggestion = (message: string) => send({ type: "suggestion", message });
  const approveSuggestion = (suggestionId: string) =>
    send({ type: "approve_suggestion", suggestion_id: suggestionId });
  const syncFile = (filename: string, content: string) =>
    send({ type: "file_update", filename, content });
  const syncCursor = (cursor: CollabCursor) => send({ type: "cursor_move", cursor });
  const syncChatMessage = (message: CollabChatMessage) =>
    send({ type: "chat_message", message });

  const isOwner = Boolean(userId && ownerId && userId === ownerId);

  return {
    connected,
    users,
    suggestions,
    cursors,
    userId,
    ownerId,
    isOwner,
    username: identity.username,
    sendSuggestion,
    approveSuggestion,
    syncFile,
    syncCursor,
    syncChatMessage,
  };
}
