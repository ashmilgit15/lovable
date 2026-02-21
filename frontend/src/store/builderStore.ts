import { create } from "zustand";

export interface FileData {
  filename: string;
  content: string;
  language?: string;
}

export interface PendingFileChange {
  filename: string;
  oldContent: string;
  newContent: string;
  language?: string;
  additions: number;
  deletions: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  model_used?: string | null;
}

export interface AutoFixState {
  phase: "idle" | "running" | "complete" | "failed";
  errorCount?: number;
  remainingErrorCount?: number;
  fixedCount?: number;
  message?: string;
}

export interface GenerationProgressItem {
  id: string;
  phase: string;
  status: "in_progress" | "complete" | "failed";
  message: string;
  createdAt: string;
}

export interface FileProgressItem {
  filename: string;
  status: "editing" | "edited";
  index: number;
  total: number;
}

export interface ChatToolConfig {
  web_search: boolean;
  url_reader: boolean;
  project_analyzer: boolean;
  typecheck: boolean;
  task_planner: boolean;
}

export interface TodoTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
}

export interface TodoPlanState {
  project_id: string;
  objective: string;
  tasks: TodoTask[];
  project_complete: boolean;
  updated_at: string;
}

interface BuilderState {
  files: Record<string, FileData>;
  activeFile: string | null;
  setFiles: (files: FileData[]) => void;
  setActiveFile: (filename: string) => void;
  updateFile: (filename: string, content: string) => void;
  applyFileUpdates: (files: FileData[]) => void;

  pendingChanges: Record<string, PendingFileChange>;
  pendingGenerationId: string | null;
  setPendingChanges: (
    changes: Record<string, PendingFileChange>,
    generationId: string | null
  ) => void;
  acceptPendingFile: (filename: string) => void;
  acceptAllPendingChanges: () => void;
  rejectPendingChanges: () => void;

  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;

  isStreaming: boolean;
  streamContent: string;
  setIsStreaming: (streaming: boolean) => void;
  appendStreamContent: (content: string) => void;
  clearStreamContent: () => void;

  autoFix: AutoFixState;
  setAutoFix: (state: AutoFixState) => void;
  autoFixEnabled: boolean;
  setAutoFixEnabled: (enabled: boolean) => void;

  activeTab: "preview" | "terminal";
  setActiveTab: (tab: "preview" | "terminal") => void;
  shouldAutoInstall: boolean;
  setShouldAutoInstall: (should: boolean) => void;

  selectedModel: string;
  setSelectedModel: (model: string) => void;
  selectedProviderId: string | null;
  setSelectedProviderId: (providerId: string | null) => void;

  chatTools: ChatToolConfig;
  setChatTools: (tools: Partial<ChatToolConfig>) => void;
  toggleChatTool: (tool: keyof ChatToolConfig) => void;

  todoPlan: TodoPlanState | null;
  setTodoPlan: (plan: TodoPlanState | null) => void;

  generationProgress: GenerationProgressItem[];
  addGenerationProgress: (item: Omit<GenerationProgressItem, "id" | "createdAt">) => void;
  clearGenerationProgress: () => void;

  fileProgress: Record<string, FileProgressItem>;
  setFileProgress: (item: FileProgressItem) => void;
  clearFileProgress: () => void;

  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;

  reset: () => void;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  files: {},
  activeFile: null,
  setFiles: (files) => {
    const fileMap: Record<string, FileData> = {};
    for (const f of files) {
      fileMap[f.filename] = f;
    }
    const active = get().activeFile;
    set({
      files: fileMap,
      activeFile: active && fileMap[active] ? active : files[0]?.filename || null,
    });
  },
  setActiveFile: (filename) => set({ activeFile: filename }),
  updateFile: (filename, content) => {
    const files = { ...get().files };
    if (files[filename]) {
      files[filename] = { ...files[filename], content };
      set({ files });
    }
  },
  applyFileUpdates: (newFiles) => {
    const files = { ...get().files };
    for (const f of newFiles) {
      files[f.filename] = f;
    }
    set({ files });
  },

  pendingChanges: {},
  pendingGenerationId: null,
  setPendingChanges: (changes, generationId) =>
    set({ pendingChanges: changes, pendingGenerationId: generationId }),
  acceptPendingFile: (filename) => {
    const state = get();
    const pending = state.pendingChanges[filename];
    if (!pending) return;

    const files = {
      ...state.files,
      [filename]: {
        filename,
        content: pending.newContent,
        language: pending.language,
      },
    };

    const nextPending = { ...state.pendingChanges };
    delete nextPending[filename];

    set({
      files,
      pendingChanges: nextPending,
      pendingGenerationId:
        Object.keys(nextPending).length > 0 ? state.pendingGenerationId : null,
    });
  },
  acceptAllPendingChanges: () => {
    const state = get();
    const files = { ...state.files };
    for (const change of Object.values(state.pendingChanges)) {
      files[change.filename] = {
        filename: change.filename,
        content: change.newContent,
        language: change.language,
      };
    }
    set({ files, pendingChanges: {}, pendingGenerationId: null });
  },
  rejectPendingChanges: () =>
    set({
      pendingChanges: {},
      pendingGenerationId: null,
    }),

  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),

  isStreaming: false,
  streamContent: "",
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamContent: (content) =>
    set((s) => ({ streamContent: s.streamContent + content })),
  clearStreamContent: () => set({ streamContent: "" }),

  autoFix: { phase: "idle" },
  setAutoFix: (autoFix) => set({ autoFix }),
  autoFixEnabled: true,
  setAutoFixEnabled: (enabled) => set({ autoFixEnabled: enabled }),

  activeTab: "preview",
  setActiveTab: (tab) => set({ activeTab: tab }),
  shouldAutoInstall: false,
  setShouldAutoInstall: (should) => set({ shouldAutoInstall: should }),

  selectedModel: "",
  setSelectedModel: (model) => set({ selectedModel: model }),
  selectedProviderId: null,
  setSelectedProviderId: (providerId) => set({ selectedProviderId: providerId }),

  chatTools: {
    web_search: false,
    url_reader: true,
    project_analyzer: true,
    typecheck: false,
    task_planner: true,
  },
  setChatTools: (tools) =>
    set((state) => ({
      chatTools: {
        ...state.chatTools,
        ...tools,
      },
    })),
  toggleChatTool: (tool) =>
    set((state) => ({
      chatTools: {
        ...state.chatTools,
        [tool]: !state.chatTools[tool],
      },
    })),

  todoPlan: null,
  setTodoPlan: (plan) => set({ todoPlan: plan }),

  generationProgress: [],
  addGenerationProgress: (item) =>
    set((state) => ({
      generationProgress: [
        ...state.generationProgress.slice(-20),
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          phase: item.phase,
          status: item.status,
          message: item.message,
        },
      ],
    })),
  clearGenerationProgress: () => set({ generationProgress: [] }),

  fileProgress: {},
  setFileProgress: (item) =>
    set((state) => ({
      fileProgress: {
        ...state.fileProgress,
        [item.filename]: item,
      },
    })),
  clearFileProgress: () => set({ fileProgress: {} }),

  activeProjectId: null,
  setActiveProjectId: (id) => set({ activeProjectId: id }),

  reset: () =>
    set({
      files: {},
      activeFile: null,
      pendingChanges: {},
      pendingGenerationId: null,
      messages: [],
      isStreaming: false,
      streamContent: "",
      autoFix: { phase: "idle" },
      autoFixEnabled: true,
      activeTab: "preview",
      shouldAutoInstall: false,
      selectedModel: "",
      selectedProviderId: null,
      chatTools: {
        web_search: false,
        url_reader: true,
        project_analyzer: true,
        typecheck: false,
        task_planner: true,
      },
      todoPlan: null,
      generationProgress: [],
      fileProgress: {},
      activeProjectId: null,
    }),
}));
