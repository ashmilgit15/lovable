import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { toast } from "sonner";

import { getProject, startCollabDiscovery } from "@/lib/api";
import { authHeaders } from "@/lib/auth";
import { apiUrl, backendWsUrl } from "@/lib/backend";
import { useWebSocket } from "@/lib/useWebSocket";
import { useBuilderStore } from "@/store/builderStore";
import { useCollabSocket } from "@/lib/useCollabSocket";
import { useConsoleMonitor } from "@/hooks/useConsoleMonitor";

import BuilderHeader from "@/components/BuilderHeader";
import CollaborationBar from "@/components/CollaborationBar";
import ChatPanel from "@/components/ChatPanel";
import FileTree from "@/components/FileTree";
import CodeEditor from "@/components/CodeEditor";
import PreviewPanel from "@/components/PreviewPanel";
import { TerminalPanel } from "@/components/TerminalPanel";
import VersionHistory from "@/components/VersionHistory";
import StatusBar from "@/components/StatusBar";
import { Button } from "@/components/ui/button";

interface BuilderWsMessage {
  type?: string;
  [key: string]: unknown;
}

function sanitizeAssistantMessage(content: string): string {
  let cleaned = (content || "").trim();
  if (!cleaned) return "";

  const hasStructuredPayload =
    /(^|\n)\s*FILE:\s*/im.test(cleaned) || /(^|\n)\s*EXPLANATION:\s*/im.test(cleaned);
  if (!hasStructuredPayload) {
    return cleaned;
  }

  cleaned = cleaned.replace(/```[\w-]*\n[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/^FILE:\s*.+$/gim, "");
  cleaned = cleaned.replace(/^\s*EXPLANATION:\s*/i, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

function buildEditedFilesSummary(
  changedFiles: Array<{ filename: string }>
): string {
  if (changedFiles.length === 0) return "";
  const maxVisible = 8;
  const lines = changedFiles
    .slice(0, maxVisible)
    .map((file) => `- ${file.filename}: edited`);
  if (changedFiles.length > maxVisible) {
    lines.push(`- +${changedFiles.length - maxVisible} more`);
  }
  return `Edited files:\n${lines.join("\n")}`;
}

export default function Builder() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [workspaceView, setWorkspaceView] = useState<"preview" | "code">("preview");
  const store = useBuilderStore();
  const queryClient = useQueryClient();
  const projectErrorHandledRef = useRef<string | null>(null);
  const prefillInput = useMemo(() => {
    if (!projectId) return null;
    const promptFromSession = sessionStorage.getItem(
      `forge:template-prompt:${projectId}`
    );
    const promptFromQuery = searchParams.get("template");
    const text = (promptFromSession || promptFromQuery || "").trim();
    if (!text) return null;
    return { text, nonce: `${projectId}:${text}` };
  }, [projectId, searchParams]);

  const {
    data,
    error: projectError,
    isError: isProjectError,
    isSuccess: isProjectLoaded,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
    retry: false,
  });
  const projectReady = Boolean(
    projectId && isProjectLoaded && data?.project?.id === projectId
  );

  useEffect(() => {
    if (!data || !projectId) return;

    const state = useBuilderStore.getState();
    state.setActiveProjectId(projectId);
    state.setAutoFixEnabled(data.project.auto_fix_enabled ?? true);
    state.setFiles(
      data.files.map((file) => ({
        filename: file.filename,
        content: file.content,
        language: file.language || undefined,
      }))
    );
    state.setMessages(
      data.messages.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant" | "system",
        content:
          message.role === "assistant"
            ? sanitizeAssistantMessage(message.content) || "Generation complete."
            : message.content,
        created_at: message.created_at,
        model_used: message.model_used,
      }))
    );
  }, [data, projectId]);

  useEffect(() => {
    projectErrorHandledRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !isProjectError) return;

    const detail =
      projectError instanceof Error
        ? projectError.message
        : "Failed to load project.";
    const errorKey = `${projectId}:${detail}`;
    if (projectErrorHandledRef.current === errorKey) return;
    projectErrorHandledRef.current = errorKey;

    if (detail.toLowerCase().includes("project not found")) {
      toast.error("Project not found. Please create a new project.");
      navigate("/dashboard", { replace: true });
      return;
    }

    toast.error("Failed to load project.");
  }, [isProjectError, navigate, projectError, projectId]);

  useEffect(() => {
    return () => {
      useBuilderStore.getState().reset();
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    const promptFromSession = sessionStorage.getItem(
      `forge:template-prompt:${projectId}`
    );
    const promptFromQuery = searchParams.get("template");
    if (promptFromSession) {
      sessionStorage.removeItem(`forge:template-prompt:${projectId}`);
    }

    if (promptFromQuery) {
      const next = new URLSearchParams(searchParams);
      next.delete("template");
      setSearchParams(next, { replace: true });
    }
  }, [projectId, searchParams, setSearchParams]);

  const wsUrl = projectReady && projectId
    ? backendWsUrl(`/ws/projects/${projectId}/chat`)
    : null;

  const collab = useCollabSocket(projectReady ? projectId : undefined, {
    onFileUpdate: (filename, content) => {
      useBuilderStore.getState().updateFile(filename, content);
    },
    onChatMessage: (message) => {
      if (!message?.id) return;
      const state = useBuilderStore.getState();
      if (state.messages.some((item) => item.id === message.id)) return;
      const normalizedMessage =
        message.role === "assistant"
          ? {
              ...message,
              content:
                sanitizeAssistantMessage(message.content) || "Generation complete.",
            }
          : message;
      state.addMessage(normalizedMessage);
    },
  });
  const hasRemoteOwner =
    collab.connected &&
    collab.users.some((user) => user.is_owner && user.id !== collab.userId);
  const suggestionMode = hasRemoteOwner && !collab.isOwner;
  const canGenerateDirectly = projectReady && !suggestionMode;

  function onWsMessage(raw: unknown) {
    const msg = (raw || {}) as BuilderWsMessage;
    const s = useBuilderStore.getState();

    if (msg.type === "progress") {
      s.addGenerationProgress({
        phase: String(msg.phase || "unknown"),
        status:
          String(msg.status || "in_progress") === "complete"
            ? "complete"
            : String(msg.status || "in_progress") === "failed"
              ? "failed"
              : "in_progress",
        message: String(msg.message || "Working..."),
      });
      return;
    }

    if (msg.type === "file_progress") {
      s.setFileProgress({
        filename: String(msg.filename || ""),
        status: String(msg.status || "editing") === "edited" ? "edited" : "editing",
        index: Number(msg.index || 0),
        total: Number(msg.total || 0),
      });
      return;
    }

    if (msg.type === "token") {
      return;
    }

    if (msg.type === "model_routed") {
      return;
    }

    if (msg.type === "todo_state") {
      const state = (msg.state || null) as
        | {
            project_id: string;
            objective: string;
            tasks: Array<{
              id: string;
              title: string;
              status: "pending" | "in_progress" | "done";
            }>;
            project_complete: boolean;
            updated_at: string;
          }
        | null;
      s.setTodoPlan(state);
      return;
    }

    if (msg.type === "canceled") {
      s.setIsStreaming(false);
      s.clearGenerationProgress();
      s.clearFileProgress();
      s.clearStreamContent();
      s.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: String(msg.content || "Generation stopped."),
        created_at: new Date().toISOString(),
      });
      return;
    }

    if (msg.type === "autofix_status") {
      if (msg.phase === "running") {
        s.setAutoFix({
          phase: "running",
          errorCount: Number(msg.error_count || 0),
          message: "Found TypeScript/runtime errors. Auto-fixing...",
        });
      } else if (msg.phase === "complete") {
        const remaining = Number(msg.remaining_error_count || 0);
        const fixed = Number(msg.fixed_count || 0);
        s.setAutoFix({
          phase: "complete",
          remainingErrorCount: remaining,
          fixedCount: fixed,
          message:
            remaining > 0
              ? `Auto-fix complete with ${remaining} remaining errors`
              : `Auto-fixed ${fixed} errors`,
        });
      } else if (msg.phase === "failed") {
        s.setAutoFix({
          phase: "failed",
          message: String(msg.message || "Auto-fix failed"),
        });
      }
      return;
    }

    if (msg.type === "autofix_applied") {
      const files = Array.isArray(msg.files)
        ? (msg.files as Array<{ filename: string; content: string; language?: string }>)
        : [];
      if (files.length > 0) {
        s.applyFileUpdates(files);
        s.setActiveFile(files[0].filename);
        s.setActiveTab("preview");
      }
      return;
    }

    if (msg.type === "complete") {
      s.setIsStreaming(false);
      s.clearFileProgress();
      const responseMode =
        String((msg as { response_mode?: string }).response_mode || "build") === "ask"
          ? "ask"
          : "build";

      const currentFiles = useBuilderStore.getState().files;
      const changedFiles: Array<{ filename: string; content: string; language?: string }> = [];

      const files = Array.isArray(msg.files)
        ? (msg.files as Array<{ filename: string; content: string; language?: string }>)
        : [];

      for (const file of files) {
        const previous = currentFiles[file.filename]?.content || "";
        const next = file.content || "";
        if (previous === next) continue;
        changedFiles.push(file);
      }

      if (changedFiles.length > 0) {
        s.applyFileUpdates(changedFiles);
        s.setActiveFile(changedFiles[0].filename);
      }
      s.setPendingChanges({}, null);

      const generatedContent =
        responseMode === "ask"
          ? String(msg.content || "").trim()
          : sanitizeAssistantMessage(String(msg.content || ""));
      const explanationContent =
        responseMode === "ask"
          ? String(msg.explanation || "").trim()
          : sanitizeAssistantMessage(String(msg.explanation || ""));
      const assistantContent =
        generatedContent ||
        explanationContent ||
        (changedFiles.length > 0
          ? `${changedFiles.length} files updated.`
          : "Generation complete.");

      const assistantMessage: {
        id: string;
        role: "assistant";
        content: string;
        created_at: string;
        model_used?: string | null;
      } = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        created_at: new Date().toISOString(),
        model_used: (msg.model_used as string | null) || null,
      };
      s.addMessage(assistantMessage);
      collab.syncChatMessage(assistantMessage);

      const editedFilesSummary =
        responseMode === "build" ? buildEditedFilesSummary(changedFiles) : "";
      if (editedFilesSummary) {
        const fileSummaryMessage: {
          id: string;
          role: "system";
          content: string;
          created_at: string;
        } = {
          id: crypto.randomUUID(),
          role: "system",
          content: editedFilesSummary,
          created_at: new Date().toISOString(),
        };
        s.addMessage(fileSummaryMessage);
        collab.syncChatMessage(fileSummaryMessage);
      }

      s.clearStreamContent();
      return;
    }

    if (msg.type === "error") {
      s.setIsStreaming(false);
      s.clearStreamContent();
      s.clearFileProgress();
      const content = String(msg.content || "Unknown websocket error");
      s.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content,
        created_at: new Date().toISOString(),
      });
      toast.error(content);
    }
  }

  const { send, connected, reconnecting } = useWebSocket(wsUrl, {
    onMessage: onWsMessage,
  });

  function sendChatMessage(
    message: string,
    options?: {
      bypassOwnerCheck?: boolean;
      hideUserMessage?: boolean;
      responseMode?: "build" | "ask";
    }
  ) {
    if (!message.trim()) return;
    if (!projectReady || !projectId) {
      toast.error("Project is not available.");
      return;
    }

    if (!options?.bypassOwnerCheck && suggestionMode) {
      collab.sendSuggestion(message);
      toast.message("Suggestion sent to owner");
      return;
    }

    if (!options?.hideUserMessage) {
      const userMessagePayload: {
        id: string;
        role: "user";
        content: string;
        created_at: string;
      } = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      store.addMessage(userMessagePayload);
      collab.syncChatMessage(userMessagePayload);
    }

    store.setIsStreaming(true);
    store.clearStreamContent();
    store.clearGenerationProgress();
    store.clearFileProgress();

    const sent = send({
      message,
      model: store.selectedModel || undefined,
      provider_id: store.selectedProviderId || undefined,
      tools: store.chatTools,
      response_mode: options?.responseMode || "build",
    });
    if (!sent) {
      store.setIsStreaming(false);
      toast.error("Connection not ready. Reconnecting...");
    }
  }

  async function stopChatMessage() {
    if (!projectReady || !projectId || !store.isStreaming) return;
    store.addGenerationProgress({
      phase: "cancel",
      status: "in_progress",
      message: "Stopping generation...",
    });
    try {
      const auth = await authHeaders();
      await fetch(apiUrl(`/api/projects/${projectId}/chat/cancel`), {
        method: "POST",
        headers: auth,
      });
    } catch {
      toast.error("Failed to stop generation");
    }
  }

  useConsoleMonitor((payload) => {
    if (!store.autoFixEnabled) return;
    if (!connected) return;
    send({
      type: "runtime_error",
      error: payload.message,
    });
  });

  useEffect(() => {
    if (!projectId || !canGenerateDirectly) return;
    startCollabDiscovery(projectId).catch(() => {
      // mDNS can fail on some platforms; keep collaboration usable without discovery.
    });
  }, [projectId, canGenerateDirectly]);

  useEffect(() => {
    const saveActiveFile = async () => {
      const state = useBuilderStore.getState();
      if (!projectId || !state.activeFile) return;
      const file = state.files[state.activeFile];
      if (!file) return;

      try {
        const auth = await authHeaders();
        await fetch(apiUrl(`/api/projects/${projectId}/files`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            filename: file.filename,
            content: file.content,
          }),
        });

        collab.syncFile(file.filename, file.content);
        toast.success("File saved");
      } catch {
        toast.error("Failed to save file");
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "`") {
        event.preventDefault();
        store.setActiveTab(store.activeTab === "terminal" ? "preview" : "terminal");
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void saveActiveFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collab, projectId, store]);

  function handleApproveSuggestion(suggestionId: string) {
    const suggestion = collab.suggestions.find((item) => item.id === suggestionId);
    if (!suggestion || !canGenerateDirectly) return;
    collab.approveSuggestion(suggestionId);
    sendChatMessage(suggestion.message, { bypassOwnerCheck: true });
  }

  async function handleRestoreVersion(
    files: Array<{ filename: string; content: string }>
  ) {
    if (!projectId || files.length === 0) return;
    const auth = await authHeaders();

    await Promise.all(
      files.map(async (file) => {
        useBuilderStore.getState().updateFile(file.filename, file.content);
        await fetch(apiUrl(`/api/projects/${projectId}/files`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify(file),
        });
      })
    );

    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    toast.success("Version restored");
  }

  const autoFixBanner = useMemo(() => {
    if (store.autoFix.phase === "idle") return null;
    if (store.autoFix.phase === "running") {
      return (
        <div className="panel-surface rounded-xl border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
          {store.autoFix.message || "Auto-fixing TypeScript/runtime errors..."}
        </div>
      );
    }
    if (store.autoFix.phase === "complete") {
      return (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {store.autoFix.message || "Auto-fix complete"}
        </div>
      );
    }
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
        {store.autoFix.message || "Auto-fix failed"}
      </div>
    );
  }, [store.autoFix]);

  return (
    <div className="app-shell flex h-screen flex-col bg-transparent text-foreground">
      <BuilderHeader
        projectId={projectId || ""}
        projectName={data?.project?.name || "Loading..."}
        connected={connected}
        reconnecting={reconnecting}
      />

      <div className="relative z-10 px-3 py-2">
        <CollaborationBar
          users={collab.users}
          connected={collab.connected}
          isOwner={canGenerateDirectly}
          suggestions={collab.suggestions}
          onApproveSuggestion={handleApproveSuggestion}
        />
      </div>

      {autoFixBanner ? (
        <div className="relative z-10 px-3 pb-2">{autoFixBanner}</div>
      ) : null}

      <PanelGroup orientation="horizontal" className="relative z-10 flex-1 min-h-0 px-3 pb-3">
        <Panel defaultSize={33} minSize={24} className="flex min-w-[320px] flex-col">
          <div className="panel-surface min-h-0 flex-1 overflow-hidden">
            <ChatPanel
              onSend={(message, responseMode) =>
                sendChatMessage(message, { responseMode })
              }
              onStop={stopChatMessage}
              isOwner={canGenerateDirectly}
              users={collab.users}
              cursors={collab.cursors}
              onCursorChange={collab.syncCursor}
              suggestions={collab.suggestions}
              onApproveSuggestion={handleApproveSuggestion}
              prefillInput={prefillInput}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="mx-2 w-[3px] rounded-full bg-white/10 transition-colors hover:bg-cyan-300/50" />

        <Panel defaultSize={67} minSize={40} className="flex min-w-[600px] flex-col">
          <div className="panel-surface flex h-full min-h-0 flex-col overflow-hidden">
            <div className="panel-header flex h-[44px] shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/35 px-3">
              <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/70 p-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-7 px-3 text-xs ${
                    workspaceView === "preview"
                      ? "bg-cyan-500/15 text-cyan-200"
                      : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                  }`}
                  onClick={() => setWorkspaceView("preview")}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-7 px-3 text-xs ${
                    workspaceView === "code"
                      ? "bg-cyan-500/15 text-cyan-200"
                      : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                  }`}
                  onClick={() => setWorkspaceView("code")}
                >
                  Code
                </Button>
              </div>

              {workspaceView === "preview" ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/70 p-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 px-2 text-xs ${
                      store.activeTab === "preview"
                        ? "bg-cyan-500/15 text-cyan-200"
                        : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                    }`}
                    onClick={() => store.setActiveTab("preview")}
                  >
                    Live
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 px-2 text-xs ${
                      store.activeTab === "terminal"
                        ? "bg-cyan-500/15 text-cyan-200"
                        : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                    }`}
                    onClick={() => store.setActiveTab("terminal")}
                  >
                    Terminal
                  </Button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  Select a file from the left to edit
                </div>
              )}
            </div>

            {workspaceView === "preview" ? (
              <div className="min-h-0 flex-1">
                {store.activeTab === "terminal" ? (
                  projectId ? <TerminalPanel projectId={projectId} /> : null
                ) : (
                  <PreviewPanel
                    onSendVisualPrompt={(prompt) =>
                      sendChatMessage(prompt, { bypassOwnerCheck: true })
                    }
                  />
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <aside className="w-[280px] shrink-0 overflow-hidden border-r border-white/10 bg-slate-950/30">
                  <FileTree
                    files={store.files}
                    activeFile={store.activeFile}
                    onSelectFile={(filename) => store.setActiveFile(filename)}
                  />
                </aside>
                <div className="min-h-0 flex-1">
                  <CodeEditor />
                </div>
                {projectId ? (
                  <VersionHistory projectId={projectId} onRestore={handleRestoreVersion} />
                ) : null}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>

      <StatusBar />
    </div>
  );
}
