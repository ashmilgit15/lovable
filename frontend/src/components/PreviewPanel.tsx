import { useBuilderStore, type FileData } from "@/store/builderStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  Terminal as TerminalIcon,
  Zap,
  AlertCircle,
  Square,
  Play,
  MousePointer2,
} from "lucide-react";
import { SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import { useDevServerSocket } from "@/lib/useDevServerSocket";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Ansi from "ansi-to-html";
import VisualEditOverlay from "@/components/VisualEditOverlay";
import {
  applyQuickVisualEdit,
  parseElementInstruction,
  type VisualElement,
  type VisualElementChange,
} from "@/lib/visualEdit";
import { authHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/backend";

const converter = new Ansi({
  fg: "#e5e7eb",
  bg: "#0d0d0d",
  newline: true,
  escapeXML: true,
});

interface PreviewPanelProps {
  onSendVisualPrompt: (prompt: string) => void;
}

interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

function normalizeSandpackPath(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function parseSandpackDeps(
  rawPackageJson: string | undefined
): Record<string, string> {
  if (!rawPackageJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawPackageJson) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const runtimeDependencies: Record<string, string> = {};
    const sourceDependencies = parsed.dependencies || {};
    const declaredDevDependencies = parsed.devDependencies || {};
    const blockedPackages = [
      /^vite$/i,
      /^esbuild$/i,
      /^@vitejs\//i,
      /^typescript$/i,
      /^eslint/i,
      /^tailwindcss$/i,
      /^postcss$/i,
      /^autoprefixer$/i,
    ];

    for (const [name, value] of Object.entries(sourceDependencies)) {
      if (typeof value !== "string") continue;
      if (blockedPackages.some((pattern) => pattern.test(name))) continue;
      runtimeDependencies[name] = value;
    }

    const hasVite =
      typeof sourceDependencies.vite === "string" ||
      typeof declaredDevDependencies.vite === "string" ||
      Object.keys(sourceDependencies).some((name) => /^@vitejs\//i.test(name)) ||
      Object.keys(declaredDevDependencies).some((name) => /^@vitejs\//i.test(name));
    if (hasVite && !runtimeDependencies["esbuild-wasm"]) {
      runtimeDependencies["esbuild-wasm"] = "^0.25.0";
    }

    return runtimeDependencies;
  } catch {
    return {};
  }
}

function parsePackageJson(rawPackageJson: string | undefined): Record<string, unknown> | null {
  if (!rawPackageJson) return null;
  try {
    const parsed = JSON.parse(rawPackageJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toStringDeps(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version === "string" && version.trim()) {
      out[name] = version;
    }
  }
  return out;
}

function hasViteTooling(files: Record<string, string>, pkg: Record<string, unknown> | null): boolean {
  const hasViteConfig = Object.keys(files).some((path) =>
    /^\/vite\.config\.(?:ts|js|mts|mjs|cts|cjs)$/i.test(path)
  );
  if (hasViteConfig) return true;
  if (!pkg) return false;

  const dependencies = toStringDeps(pkg.dependencies);
  const devDependencies = toStringDeps(pkg.devDependencies);
  if (dependencies.vite || devDependencies.vite) return true;

  const scripts = pkg.scripts && typeof pkg.scripts === "object"
    ? (pkg.scripts as Record<string, unknown>)
    : {};
  const scriptValues = Object.values(scripts)
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return /\bvite\b/i.test(scriptValues);
}

function normalizePackageJsonForSandbox(
  sandpackFiles: Record<string, string>,
  entry: string | undefined
): {
  dependencies: Record<string, string>;
  hasPackageJson: boolean;
  usesVite: boolean;
} {
  const rawPackageJson = sandpackFiles["/package.json"];
  const parsed = parsePackageJson(rawPackageJson);
  if (!parsed) {
    return {
      dependencies: parseSandpackDeps(rawPackageJson),
      hasPackageJson: false,
      usesVite: false,
    };
  }

  const dependencies = toStringDeps(parsed.dependencies);
  const devDependencies = toStringDeps(parsed.devDependencies);
  const usesVite = hasViteTooling(sandpackFiles, parsed);

  const normalized: Record<string, unknown> = {
    ...parsed,
    dependencies: { ...dependencies },
  };

  if (usesVite) {
    const toolingAllowlist = new Set([
      "vite",
      "esbuild",
      "esbuild-wasm",
      "@vitejs/plugin-react",
      "@vitejs/plugin-react-swc",
      "@tailwindcss/vite",
      "tailwindcss",
      "postcss",
      "autoprefixer",
      "typescript",
    ]);

    for (const [name, version] of Object.entries(devDependencies)) {
      if (toolingAllowlist.has(name)) {
        (normalized.dependencies as Record<string, string>)[name] = version;
      }
    }

    if (!(normalized.dependencies as Record<string, string>).vite) {
      (normalized.dependencies as Record<string, string>).vite = "^7.3.1";
    }
    if (!(normalized.dependencies as Record<string, string>)["esbuild-wasm"]) {
      (normalized.dependencies as Record<string, string>)["esbuild-wasm"] = "^0.25.0";
    }

    const scripts =
      parsed.scripts && typeof parsed.scripts === "object"
        ? { ...(parsed.scripts as Record<string, unknown>) }
        : {};
    const startScript = typeof scripts.start === "string" ? scripts.start : "";
    if (!/\bvite\b/i.test(startScript)) {
      scripts.start = "vite --host 0.0.0.0 --port 3000";
    }
    normalized.scripts = scripts;
  }

  normalized.main =
    entry ||
    (typeof parsed.main === "string" && parsed.main.trim() ? parsed.main : "/src/main.tsx");

  // Sandpack installs runtime deps only; keeping dev deps often causes confusion for Vite projects.
  delete normalized.devDependencies;

  sandpackFiles["/package.json"] = JSON.stringify(normalized, null, 2);
  return {
    dependencies: normalized.dependencies as Record<string, string>,
    hasPackageJson: true,
    usesVite,
  };
}

function pickFallbackCssFile(availableFiles: Record<string, string>): string | null {
  const preferred = [
    "/src/index.css",
    "/src/App.css",
    "/index.css",
    "/styles.css",
  ];
  for (const candidate of preferred) {
    if (Object.prototype.hasOwnProperty.call(availableFiles, candidate)) {
      return candidate;
    }
  }

  const firstCss = Object.keys(availableFiles).find(
    (path) => path.endsWith(".css") && !path.includes("/node_modules/")
  );
  return firstCss || null;
}

function normalizeBuiltIndexHtmlForSandbox(
  indexHtml: string,
  entry: string | undefined,
  availableFiles: Record<string, string>
): string {
  if (!entry) return indexHtml;

  const hasBuiltAssetRefs = /\/assets\/[^"']+\.(?:css|js)/i.test(indexHtml);
  if (!hasBuiltAssetRefs) return indexHtml;

  const hasFile = (path: string) => {
    const normalizedPath = normalizeSandpackPath(path);
    return Object.prototype.hasOwnProperty.call(availableFiles, normalizedPath);
  };

  const fallbackCssFile = pickFallbackCssFile(availableFiles);

  let normalized = indexHtml;
  normalized = normalized.replace(
    /<link[^>]+href=["']([^"']+\.css)["'][^>]*>\s*/gi,
    (fullMatch, cssPath: string) => {
      if (hasFile(cssPath)) return fullMatch;
      if (fallbackCssFile) {
        return fullMatch.replace(cssPath, fallbackCssFile);
      }
      return fullMatch;
    }
  );

  const scriptPattern =
    /<script[^>]+src=["'](\/assets\/[^"']+\.js)["'][^>]*>\s*<\/script>/i;

  // Convert something like /src/main.tsx to src/main.tsx or /main.tsx for the browser preview
  const previewEntry = entry.startsWith('/') ? entry : `/${entry}`;

  if (scriptPattern.test(normalized)) {
    normalized = normalized.replace(
      scriptPattern,
      (fullMatch, scriptPath: string) =>
        hasFile(scriptPath)
          ? fullMatch
          : entry
            ? `<script type="module" src="${previewEntry}"></script>`
            : fullMatch
    );
  } else if (/<\/body>/i.test(normalized)) {
    if (entry) {
      normalized = normalized.replace(
        /<\/body>/i,
        `  <script type="module" src="${previewEntry}"></script>\n</body>`
      );
    }
  } else if (normalized.includes('<script type="module" src="/src/main.tsx">')) {
    normalized = normalized.replace('<script type="module" src="/src/main.tsx">', `<script type="module" src="${previewEntry}">`);
  }

  return normalized;
}

function buildSandpackProject(files: Record<string, FileData>) {
  const sandpackFiles: Record<string, string> = {};

  for (const file of Object.values(files)) {
    if (!file?.filename) continue;
    sandpackFiles[normalizeSandpackPath(file.filename)] = file.content ?? "";
  }

  const entryCandidates = [
    "/src/main.tsx",
    "/src/main.jsx",
    "/src/index.tsx",
    "/src/index.jsx",
    "/main.tsx",
    "/main.jsx",
    "/index.tsx",
    "/index.jsx",
  ];
  const entry = entryCandidates.find((candidate) => sandpackFiles[candidate]);
  const activeFile = entry || Object.keys(sandpackFiles)[0] || "/src/main.tsx";

  const { dependencies, hasPackageJson, usesVite } = normalizePackageJsonForSandbox(
    sandpackFiles,
    entry
  );

  if (sandpackFiles["/index.html"]) {
    sandpackFiles["/index.html"] = normalizeBuiltIndexHtmlForSandbox(
      sandpackFiles["/index.html"],
      entry,
      sandpackFiles
    );
  }

  const hasTypescript = Object.keys(sandpackFiles).some(
    (path) => path.endsWith(".ts") || path.endsWith(".tsx")
  );
  const template = usesVite
    ? hasTypescript
      ? "vite-react-ts"
      : "vite-react"
    : hasTypescript
      ? "react-ts"
      : "react";
  const environment = usesVite
    ? "node"
    : hasTypescript
      ? "create-react-app-typescript"
      : "create-react-app";

  return {
    files: sandpackFiles,
    dependencies: hasPackageJson ? {} : dependencies,
    entry,
    environment,
    activeFile,
    fileCount: Object.keys(sandpackFiles).length,
    template,
  } as const;
}

export default function PreviewPanel({ onSendVisualPrompt }: PreviewPanelProps) {
  const activeProjectId = useBuilderStore((state) => state.activeProjectId);
  const files = useBuilderStore((state) => state.files);
  const updateFile = useBuilderStore((state) => state.updateFile);
  const [showLogs, setShowLogs] = useState(false);
  const [visualEditEnabled, setVisualEditEnabled] = useState(false);
  const [selectedElement, setSelectedElement] = useState<VisualElement | null>(null);
  const [sandboxRefreshKey, setSandboxRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSandboxRecoverAtRef = useRef(0);

  const isHostedClient = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1";
  }, []);

  const useBrowserPreview = isHostedClient;
  const sandpackProject = useMemo(() => buildSandpackProject(files), [files]);

  const {
    logs,
    port,
    isRunning,
    isStarting,
    error,
    isDisabled,
    startServer,
    stopServer,
    restartServer,
  } = useDevServerSocket(
    useBrowserPreview ? undefined : (activeProjectId || undefined)
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!useBrowserPreview || typeof window === "undefined") return;

    const maybeRecover = (message: string) => {
      if (!message.toLowerCase().includes("failed to get shell by id")) return;
      const now = Date.now();
      if (now - lastSandboxRecoverAtRef.current < 3000) return;
      lastSandboxRecoverAtRef.current = now;
      setSandboxRefreshKey((key) => key + 1);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      if (typeof reason === "string") {
        maybeRecover(reason);
        return;
      }
      if (reason instanceof Error) {
        maybeRecover(reason.message || "");
        return;
      }
      try {
        maybeRecover(JSON.stringify(reason ?? ""));
      } catch {
        // no-op
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      maybeRecover(event.message || "");
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, [useBrowserPreview]);

  const previewUrl = useMemo(() => {
    if (!port) return null;
    return `http://localhost:${port}`;
  }, [port]);

  const previewOrigin = useMemo(() => {
    if (!previewUrl) return null;
    try {
      return new URL(previewUrl).origin;
    } catch {
      return null;
    }
  }, [previewUrl]);

  const sendBridgeMessage = useCallback(
    (payload: BridgeMessage) => {
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage(payload, previewOrigin ?? "*");
    },
    [previewOrigin]
  );

  useEffect(() => {
    sendBridgeMessage({
      type: "forge:visual-edit:toggle",
      enabled: visualEditEnabled,
    });
  }, [visualEditEnabled, sendBridgeMessage]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const expectedSource = iframeRef.current?.contentWindow;
      if (!expectedSource || event.source !== expectedSource) return;
      if (previewOrigin && event.origin !== previewOrigin) return;

      const data = event.data as {
        source?: string;
        type?: string;
        payload?: unknown;
      };
      if (!data || data.source !== "forge-preview") return;
      if (data.type === "visual-select") {
        setSelectedElement(data.payload as VisualElement);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [previewOrigin]);

  const handleApplyVisualChange = async (change: VisualElementChange) => {
    if (!selectedElement || !activeProjectId) return;

    sendBridgeMessage({
      type: "forge:visual-edit:apply",
      change: {
        selector: selectedElement.selector,
        text: change.text,
        className: change.className,
        styles: change.styles,
      },
    });

    const { targetFile } = parseElementInstruction(selectedElement, change, files);
    const target = files[targetFile];
    if (!target) return;

    const updatedContent = applyQuickVisualEdit(
      target.content,
      selectedElement,
      change
    );
    if (updatedContent === target.content) return;

    updateFile(targetFile, updatedContent);
    const auth = await authHeaders();

    await fetch(apiUrl(`/api/projects/${activeProjectId}/files`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        filename: targetFile,
        content: updatedContent,
      }),
    });
  };

  const handleAskAI = (change: VisualElementChange) => {
    if (!selectedElement) return;
    const { prompt } = parseElementInstruction(selectedElement, change, files);
    onSendVisualPrompt(prompt);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className="panel-header flex h-[40px] shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/35 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {useBrowserPreview ? (
              <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">
                  Sandbox
                </span>
              </div>
            ) : isRunning ? (
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                  Live
                </span>
              </div>
            ) : isStarting ? (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500">
                  Booting
                </span>
              </div>
            ) : isDisabled ? (
              <div className="flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-orange-500">
                  Disabled
                </span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-red-500">
                  Error
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  Offline
                </span>
              </div>
            )}
            {!useBrowserPreview && port ? (
              <span className="font-mono text-[10px] text-gray-500">localhost:{port}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!useBrowserPreview ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-[10px] gap-1.5 transition-colors",
                  visualEditEnabled
                    ? "bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                    : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                )}
                onClick={() =>
                  setVisualEditEnabled((prev) => {
                    const next = !prev;
                    if (!next) {
                      setSelectedElement(null);
                    }
                    return next;
                  })
                }
              >
                <MousePointer2 className="h-3 w-3" />
                Visual Edit
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-[10px] gap-1.5 transition-colors",
                  showLogs
                    ? "bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200"
                    : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                )}
                onClick={() => setShowLogs((prev) => !prev)}
              >
                <TerminalIcon className="h-3 w-3" />
                Logs
              </Button>

              <div className="mx-1 h-3 w-[1px] bg-white/10" />
            </>
          ) : null}

          {useBrowserPreview ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
              onClick={() => setSandboxRefreshKey((key) => key + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          ) : isRunning ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => {
                  if (iframeRef.current) {
                    const src = iframeRef.current.src;
                    const separator = src.includes("?") ? "&" : "?";
                    iframeRef.current.src = `${src}${separator}refresh=${Date.now()}`;
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => {
                  if (!previewUrl) return;
                  const opened = window.open(
                    previewUrl,
                    "_blank",
                    "noopener,noreferrer"
                  );
                  if (opened) opened.opener = null;
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
                onClick={stopServer}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[10px] text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
              onClick={startServer}
              disabled={isStarting || isDisabled}
            >
              <Play className="h-3 w-3 fill-current" />
              {isDisabled ? "Dev Server Disabled" : isStarting ? "Starting..." : "Start Dev Server"}
            </Button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {useBrowserPreview ? (
          sandpackProject.fileCount > 0 ? (
            <div className="flex min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]">
              <SandpackProvider
                key={`${activeProjectId ?? "project"}:${sandboxRefreshKey}`}
                template={sandpackProject.template}
                files={sandpackProject.files}
                customSetup={{
                  dependencies: sandpackProject.dependencies,
                  entry: sandpackProject.entry,
                  environment: sandpackProject.environment,
                }}
                options={{
                  activeFile: sandpackProject.activeFile,
                  autoReload: true,
                }}
              >
                <SandpackPreview
                  showNavigator={false}
                  showOpenInCodeSandbox={false}
                  showRefreshButton
                  showRestartButton
                  style={{ height: "100%" }}
                  className="forge-sandpack-preview flex min-h-0 flex-1 [&_.sp-stack]:min-h-0 [&_.sp-stack]:h-full [&_.sp-stack]:w-full [&_.sp-preview]:min-h-0 [&_.sp-preview]:h-full [&_.sp-preview]:w-full [&_.sp-preview-container]:min-h-0 [&_.sp-preview-container]:h-full [&_.sp-preview-container]:w-full [&_.sp-preview-container]:flex-1 [&_.sp-preview-iframe]:block [&_.sp-preview-iframe]:min-h-0 [&_.sp-preview-iframe]:h-full [&_.sp-preview-iframe]:w-full [&_.sp-preview-iframe]:flex-1 [&_.sp-bridge-frame]:hidden [&_iframe]:block [&_iframe]:h-full [&_iframe]:w-full"
                />
              </SandpackProvider>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center bg-[#0a0a0a] p-6 text-center">
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-500/10">
                  <AlertCircle className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="mb-2 font-medium text-white">Waiting For Generated Files</h3>
                <p className="text-sm leading-relaxed text-gray-500">
                  Send a prompt to generate files. They will render here in a browser sandbox.
                </p>
              </div>
            </div>
          )
        ) : previewUrl && isRunning ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="h-full w-full bg-white transition-opacity duration-300"
            title="Preview"
            onLoad={() =>
              sendBridgeMessage({
                type: "forge:visual-edit:toggle",
                enabled: visualEditEnabled,
              })
            }
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-[#0a0a0a] p-6 text-center">
            {isDisabled ? (
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
                  <AlertCircle className="h-6 w-6 text-orange-400" />
                </div>
                <h3 className="mb-2 font-medium text-white">Dev Server Disabled</h3>
                <p className="text-sm leading-relaxed text-gray-500">
                  Live preview is disabled on this backend deployment. Enable untrusted code execution on the backend or run locally to use the dev server preview.
                </p>
              </div>
            ) : error ? (
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <h3 className="mb-2 font-medium text-white">Development Server Failed</h3>
                <p className="mb-6 text-sm leading-relaxed text-gray-500">{error}</p>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={restartServer}
                    className="gap-2 bg-red-500 text-white transition-all active:scale-95 hover:bg-red-600"
                  >
                    <Zap className="h-4 w-4 fill-current" />
                    Attempt Auto-Fix & Restart
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowLogs(true)}
                    className="gap-2 border-white/15 text-slate-300 hover:bg-slate-800/60"
                  >
                    <TerminalIcon className="h-4 w-4" />
                    View Logs
                  </Button>
                </div>
              </div>
            ) : isStarting ? (
              <div className="flex flex-col items-center animate-in fade-in duration-500">
                <div className="relative mb-6 h-16 w-16">
                  <div className="absolute inset-0 rounded-xl border-2 border-cyan-500/20" />
                  <div className="absolute inset-0 animate-spin rounded-xl border-2 border-t-cyan-400" />
                  <Zap className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-cyan-300" />
                </div>
                <h3 className="mb-2 font-medium text-gray-200">Booting Environment</h3>
                <p className="max-w-[200px] text-sm leading-relaxed text-gray-500">
                  Running npm install and starting Vite dev server...
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center opacity-40 transition-opacity duration-500 hover:opacity-100">
                <Zap className="mb-4 h-12 w-12 text-gray-600" />
                <p className="mb-6 text-sm text-gray-500">
                  Development server is not running
                </p>
                <Button
                  onClick={startServer}
                  variant="outline"
                  className="border-slate-700 transition-all active:scale-95 hover:border-cyan-400/50 hover:bg-cyan-500/5"
                >
                  Start Environment
                </Button>
              </div>
            )}
          </div>
        )}

        {!useBrowserPreview && visualEditEnabled ? (
          <VisualEditOverlay
            key={selectedElement?.selector || "visual-overlay"}
            enabled={visualEditEnabled}
            selectedElement={selectedElement}
            onApply={handleApplyVisualChange}
            onAskAI={handleAskAI}
            onClose={() => {
              setVisualEditEnabled(false);
              setSelectedElement(null);
            }}
          />
        ) : null}

        {!useBrowserPreview && showLogs ? (
          <div className="absolute inset-x-0 bottom-0 z-20 flex h-1/2 flex-col animate-in slide-in-from-bottom border-t border-white/10 bg-slate-950/95 duration-300">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/70 px-4 py-2">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-3.5 w-3.5 text-cyan-300" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Logs
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => setShowLogs(false)}
              >
                <Square className="h-3 w-3 rotate-45" />
              </Button>
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed selection:bg-cyan-500/30"
            >
              {logs.length > 0 ? (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className="mb-0.5 break-all whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: converter.toHtml(log) }}
                  />
                ))
              ) : (
                <div className="flex h-full items-center justify-center italic text-gray-700">
                  No logs yet.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
