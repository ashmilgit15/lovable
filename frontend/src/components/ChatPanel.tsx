import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Send,
  Loader2,
  Sparkles,
  Save,
  Crown,
  Wand2,
  Check,
  CircleDashed,
  FilePenLine,
  CheckCircle2,
  Globe,
  Link2,
  FolderSearch,
  ShieldCheck,
  Square,
  ListTodo,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { useBuilderStore, type ChatToolConfig } from "@/store/builderStore";
import { saveTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function isNearBottom(element: HTMLDivElement, threshold = 80): boolean {
  const remaining = element.scrollHeight - (element.scrollTop + element.clientHeight);
  return remaining <= threshold;
}

interface ChatPanelProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isOwner: boolean;
  users: Array<{ id: string; username: string; color: string }>;
  cursors: Record<string, { position?: number }>;
  onCursorChange: (cursor: { position: number }) => void;
  suggestions: Array<{
    id: string;
    username: string;
    message: string;
  }>;
  onApproveSuggestion: (suggestionId: string) => void;
  prefillInput?: {
    text: string;
    nonce: string | number;
  } | null;
}

const TOOL_OPTIONS: Array<{
  key: keyof ChatToolConfig;
  label: string;
  helper: string;
  Icon: typeof Globe;
  activeClasses: string;
}> = [
  {
    key: "web_search",
    label: "Web Search",
    helper: "Injects fresh search context",
    Icon: Globe,
    activeClasses: "border-cyan-500/30 bg-cyan-500/15 text-cyan-200",
  },
  {
    key: "url_reader",
    label: "URL Reader",
    helper: "Reads linked pages in prompts",
    Icon: Link2,
    activeClasses: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
  },
  {
    key: "project_analyzer",
    label: "Project Analyzer",
    helper: "Analyzes files before edits",
    Icon: FolderSearch,
    activeClasses: "border-violet-500/30 bg-violet-500/15 text-violet-200",
  },
  {
    key: "typecheck",
    label: "Typecheck Context",
    helper: "Adds TS diagnostics to context",
    Icon: ShieldCheck,
    activeClasses: "border-amber-500/30 bg-amber-500/15 text-amber-200",
  },
  {
    key: "task_planner",
    label: "Task Planner",
    helper: "Splits work into todo steps",
    Icon: ListTodo,
    activeClasses: "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-200",
  },
];

export default function ChatPanel({
  onSend,
  onStop,
  isOwner,
  users,
  cursors,
  onCursorChange,
  suggestions,
  onApproveSuggestion,
  prefillInput,
}: ChatPanelProps) {
  const messages = useBuilderStore((state) => state.messages);
  const isStreaming = useBuilderStore((state) => state.isStreaming);
  const streamContent = useBuilderStore((state) => state.streamContent);
  const generationProgress = useBuilderStore((state) => state.generationProgress);
  const fileProgress = useBuilderStore((state) => state.fileProgress);
  const chatTools = useBuilderStore((state) => state.chatTools);
  const toggleChatTool = useBuilderStore((state) => state.toggleChatTool);
  const todoPlan = useBuilderStore((state) => state.todoPlan);
  const [inputValue, setInputValue] = useState("");
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const enabledTools = TOOL_OPTIONS.filter((option) => chatTools[option.key]);

  useEffect(() => {
    if (!scrollViewportRef.current || !stickToBottom) return;
    scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight;
  }, [
    messages,
    isStreaming,
    streamContent,
    suggestions,
    generationProgress,
    fileProgress,
    todoPlan,
    stickToBottom,
  ]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      120
    )}px`;
  }, [inputValue]);

  useEffect(() => {
    if (!prefillInput?.text) return;
    setInputValue(prefillInput.text);
    setStickToBottom(true);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const end = textarea.value.length;
      textarea.selectionStart = end;
      textarea.selectionEnd = end;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });
  }, [prefillInput?.nonce, prefillInput?.text]);

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    onSend(inputValue.trim());
    setStickToBottom(true);
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleCursorSync = () => {
    const position = textareaRef.current?.selectionStart || 0;
    onCursorChange({ position });
  };

  const handleScrollViewport = () => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    setStickToBottom(isNearBottom(viewport));
  };

  const handleSaveTemplate = async (content: string, messageId: string) => {
    const templateName = prompt("Template name", "Custom Prompt");
    if (!templateName) return;
    const templateDescription =
      prompt("Short description", "Saved from chat message") ||
      "Saved from chat message";
    const tags =
      prompt("Tags (comma separated)", "custom,prompt")
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean) || [];

    try {
      setSavingMessageId(messageId);
      await saveTemplate({
        name: templateName.trim(),
        description: templateDescription.trim(),
        prompt: content,
        tags,
      });
      toast.success("Saved as template");
    } catch {
      toast.error("Failed to save template");
    } finally {
      setSavingMessageId(null);
    }
  };

  return (
    <div className="flex h-full flex-col border-r border-white/10 bg-slate-950/35">
      <div className="panel-header border-b border-white/10 bg-slate-950/35 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Chat</h2>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {isOwner ? "Owner mode" : "Suggestion mode"}
            </p>
          </div>
          {isOwner ? (
            <div className="chip border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
              <Crown className="h-3 w-3" />
              Owner
            </div>
          ) : (
            <div className="chip border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">
              <Wand2 className="h-3 w-3" />
              Suggest
            </div>
          )}
        </div>

        {isOwner && suggestions.length > 0 ? (
          <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-300">Pending suggestion</p>
            <p className="text-xs text-amber-100">
              <span className="font-semibold">{suggestions[0].username}:</span>{" "}
              {suggestions[0].message}
            </p>
            <Button
              size="sm"
              className="mt-2 h-6 bg-amber-500/30 text-[10px] text-amber-50 hover:bg-amber-500/40"
              onClick={() => onApproveSuggestion(suggestions[0].id)}
            >
              <Check className="mr-1 h-3 w-3" />
              Approve and send
            </Button>
          </div>
        ) : null}

      </div>

      <div
        className="no-scrollbar flex flex-1 flex-col space-y-6 overflow-y-auto p-4 scroll-smooth"
        ref={scrollViewportRef}
        onScroll={handleScrollViewport}
      >
        {messages.length === 0 && !isStreaming ? (
          <div className="animate-in fade-in duration-500 py-12 text-center text-slate-500">
            <div className="mb-4 inline-flex rounded-full border border-white/10 bg-slate-900/70 p-4">
              <Sparkles className="h-6 w-6 text-cyan-300" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-slate-200">
              Describe what to build
            </h3>
            <p className="mx-auto max-w-[220px] text-xs leading-relaxed">
              One sends your request to the active provider and returns complete file updates.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "group flex w-fit max-w-[90%] flex-col gap-1",
              message.role === "user"
                ? "ml-auto self-end items-end"
                : "self-start items-start"
            )}
          >
            <div
              className={cn(
                "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                message.role === "user"
                  ? "rounded-tr-sm bg-gradient-to-br from-cyan-500 to-teal-500 text-slate-950"
                  : "rounded-tl-sm border-l-2 border-cyan-400/50 bg-slate-900/70 text-slate-200"
              )}
            >
              {message.role !== "user" ? (
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-cyan-300">
                  <Sparkles className="h-3 w-3" />
                  AI Assistant
                  {message.model_used ? (
                    <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-cyan-200">
                      {message.model_used}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            </div>

            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] text-gray-600">
                {format(new Date(message.created_at), "h:mm a")}
              </span>
              {message.role !== "system" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 gap-1 px-1.5 text-[10px] text-slate-500 opacity-0 transition-opacity hover:bg-slate-800/70 hover:text-cyan-300 group-hover:opacity-100"
                  onClick={() => handleSaveTemplate(message.content, message.id)}
                  disabled={savingMessageId === message.id}
                >
                  {savingMessageId === message.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  Save as Template
                </Button>
              ) : null}
            </div>
          </div>
        ))}

        {todoPlan?.tasks?.length ? (
          <div className="flex max-w-[90%] flex-col gap-1 self-start items-start">
            <div className="min-w-[250px] rounded-2xl rounded-tl-sm border-l-2 border-fuchsia-400/50 bg-slate-900/80 px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fuchsia-300">
                <ListTodo className="h-3.5 w-3.5" />
                Project Todo
                {todoPlan.project_complete ? (
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Complete
                  </span>
                ) : null}
              </div>
              {todoPlan.objective ? (
                <p className="mb-2 text-[11px] text-slate-400" title={todoPlan.objective}>
                  {todoPlan.objective}
                </p>
              ) : null}
              <div className="space-y-1.5">
                {todoPlan.tasks.slice(0, 10).map((task, index) => (
                  <div key={task.id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                        task.status === "done"
                          ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
                          : task.status === "in_progress"
                            ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-500/40 bg-slate-700/50 text-slate-300"
                      )}
                    >
                      {task.status === "done" ? (
                        <Check className="h-2.5 w-2.5" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span
                      className={cn(
                        "leading-relaxed",
                        task.status === "done"
                          ? "text-emerald-200 line-through"
                          : task.status === "in_progress"
                            ? "text-cyan-100"
                            : "text-slate-300"
                      )}
                      title={task.title}
                    >
                      {task.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <span className="px-1 text-[10px] text-slate-600">
              {format(new Date(todoPlan.updated_at), "h:mm a")}
            </span>
          </div>
        ) : null}

        {isStreaming ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex max-w-[90%] flex-col gap-1 self-start items-start">
            <div className="min-w-[220px] rounded-2xl rounded-tl-sm border-l-2 border-cyan-400/50 bg-slate-900/75 px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-cyan-300">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Generating...
              </div>
              <div className="mb-2 flex items-center gap-2">
                <div className="relative h-2 w-2 rounded-full bg-cyan-300">
                  <span className="absolute -left-1 -top-1 h-4 w-4 animate-ping rounded-full bg-cyan-400/40" />
                </div>
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
                </div>
                <span className="text-xs text-cyan-200">Live progress</span>
              </div>

              {streamContent ? (
                <div className="mb-3 max-h-48 overflow-auto rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs leading-relaxed text-slate-200">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-cyan-300">
                    Live Output
                  </div>
                  <div className="whitespace-pre-wrap font-mono">{streamContent}</div>
                </div>
              ) : null}

              <div className="space-y-2 py-1">
                {generationProgress.slice(-4).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    {item.status === "complete" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <CircleDashed className="h-3.5 w-3.5 animate-spin text-cyan-300" />
                    )}
                    <span className="text-slate-300">{item.message}</span>
                  </div>
                ))}
                {generationProgress.length === 0 ? (
                  <div className="flex items-center gap-2 py-2 text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs">
                      {streamContent ? "Streaming..." : "Thinking..."}
                    </span>
                  </div>
                ) : null}
              </div>

              {Object.values(fileProgress).length > 0 ? (
                <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-cyan-300">
                    File Updates
                  </div>
                  <div className="space-y-1">
                    {Object.values(fileProgress)
                      .sort((a, b) => a.index - b.index)
                      .slice(0, 6)
                      .map((item) => (
                        <div key={item.filename} className="flex items-center gap-2 text-xs">
                          <FilePenLine className="h-3 w-3 text-cyan-300" />
                          <span className="truncate text-slate-300">{item.filename}</span>
                          <span
                            className={cn(
                              "ml-auto rounded px-1.5 py-0.5 text-[10px]",
                              item.status === "edited"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-amber-500/20 text-amber-300"
                            )}
                          >
                            {item.status === "edited" ? "edited" : "editing"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 bg-slate-950/40 p-4">
        <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-slate-900/75 p-2 transition-colors focus-within:border-cyan-400/40">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mb-1 h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="z-[80] mb-3 w-72 border-white/10 bg-slate-900/95 p-2 text-slate-200 backdrop-blur-md"
            >
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Chat Tools
              </p>
              <div className="space-y-1">
                {TOOL_OPTIONS.map((option) => {
                  const enabled = chatTools[option.key];
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleChatTool(option.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left transition-colors",
                        enabled
                          ? option.activeClasses
                          : "bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{option.label}</p>
                        <p className="truncate text-[10px] text-slate-500">{option.helper}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          enabled
                            ? "bg-slate-950/40 text-slate-100"
                            : "bg-slate-700/50 text-slate-400"
                        )}
                      >
                        {enabled ? "On" : "Off"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 px-1 text-[10px] text-slate-500">
                Toggle tools for the next request. Planner updates appear in chat.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onClick={handleCursorSync}
            onKeyUp={handleCursorSync}
            placeholder={isOwner ? "Type a message..." : "Suggest a message for the owner..."}
            className="min-h-[44px] max-h-[120px] flex-1 resize-none border-none bg-transparent px-2 py-3 text-sm text-slate-200 placeholder:text-slate-500 outline-none"
            rows={1}
            disabled={isStreaming}
          />

          <Button
            onClick={() => {
              if (isStreaming) {
                onStop();
                return;
              }
              handleSubmit();
            }}
            size="icon"
            disabled={isStreaming ? false : !inputValue.trim()}
            className={cn(
              "mb-1 h-9 w-9 transition-all duration-200",
              isStreaming
                ? "bg-red-500/80 text-white shadow-lg shadow-red-900/30 hover:bg-red-500"
                : inputValue.trim()
                ? "bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-900/25 hover:brightness-110"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700"
            )}
          >
            {isStreaming ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {enabledTools.length > 0 ? (
            enabledTools.map((option) => {
              const Icon = option.Icon;
              return (
                <span
                  key={option.key}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                    option.activeClasses
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {option.label}
                </span>
              );
            })
          ) : (
            <span className="text-[10px] text-slate-500">
              No tools enabled. Use the + button to toggle tools.
            </span>
          )}
        </div>

        <div className="mt-2 text-center text-[10px] text-slate-600">
          Press <kbd className="rounded border border-white/10 bg-slate-900 px-1 py-0.5 font-sans">Enter</kbd> to{" "}
          {isOwner ? "send" : "suggest"},{" "}
          <kbd className="rounded border border-white/10 bg-slate-900 px-1 py-0.5 font-sans">Shift + Enter</kbd> for new line
        </div>
        {Object.keys(cursors).length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {users
              .filter((user) => cursors[user.id])
              .map((user) => (
                <div
                  key={user.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-white"
                  style={{ backgroundColor: user.color }}
                >
                  {user.username}
                </div>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
