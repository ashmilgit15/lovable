import Editor, { useMonaco } from "@monaco-editor/react";
import { useBuilderStore } from "@/store/builderStore";
import { useEffect, useState } from "react";
import { Copy, Check, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CodeEditor() {
  const activeFile = useBuilderStore((state) => state.activeFile);
  const files = useBuilderStore((state) => state.files);
  const updateFile = useBuilderStore((state) => state.updateFile);
  const [copied, setCopied] = useState(false);
  const monaco = useMonaco();

  const file = activeFile ? files[activeFile] : null;

  useEffect(() => {
    if (!monaco) return;
    monaco.editor.defineTheme("one-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0b1322",
        "editor.lineHighlightBackground": "#122037",
        "editorLineNumber.foreground": "#48607f",
      },
    });
    monaco.editor.setTheme("one-dark");
  }, [monaco]);

  const handleCopy = () => {
    if (!file) return;
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-transparent text-slate-500">
        <FileCode className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm">Select a file to start editing</p>
      </div>
    );
  }

  const languageMap: Record<string, string> = {
    tsx: "typescript",
    ts: "typescript",
    jsx: "javascript",
    js: "javascript",
    html: "html",
    css: "css",
    json: "json",
    md: "markdown",
  };

  const ext = file.filename.split(".").pop() || "";
  const language = file.language || languageMap[ext] || "plaintext";
  const lineCount = file.content.split("\n").length;
  const charCount = file.content.length;

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="panel-header flex h-[40px] shrink-0 items-center justify-between border-b border-white/10 bg-transparent px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="text-slate-500">{file.filename.split("/").slice(0, -1).join("/")} /</span>
          <span className="font-medium text-cyan-300">{file.filename.split("/").pop()}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 gap-1.5 px-2 text-[10px] text-slate-500 hover:text-slate-100"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <Editor
          height="100%"
          language={language}
          value={file.content}
          path={file.filename}
          theme="one-dark"
          onChange={(value) => {
            if (value !== undefined && activeFile) {
              updateFile(activeFile, value);
            }
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
            tabSize: 2,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 16, bottom: 16 },
            fontFamily: "'JetBrains Mono', monospace",
            renderLineHighlight: "all",
          }}
        />
      </div>

      <div className="flex h-[24px] shrink-0 select-none items-center justify-between border-t border-white/10 bg-slate-900/70 px-4 py-1 text-[10px] text-slate-500">
        <div className="flex gap-4">
          <span>{lineCount} lines</span>
          <span>{charCount} chars</span>
        </div>
        <div className="flex gap-4">
          <span>{language}</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}
