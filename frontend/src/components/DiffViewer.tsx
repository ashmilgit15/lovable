import { DiffEditor } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Check, RotateCcw } from "lucide-react";

interface DiffViewerProps {
  filename: string;
  language: string;
  original: string;
  modified: string;
  additions: number;
  deletions: number;
  onAccept: () => void;
  onReject: () => void;
}

export default function DiffViewer({
  filename,
  language,
  original,
  modified,
  additions,
  deletions,
  onAccept,
  onReject,
}: DiffViewerProps) {
  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex h-[40px] shrink-0 items-center justify-between border-b border-[#1e1e1e] px-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-violet-300">{filename}</span>
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
            +{additions}
          </span>
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
            -{deletions}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={onReject}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
            onClick={onAccept}
          >
            <Check className="h-3.5 w-3.5" />
            Accept File
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DiffEditor
          height="100%"
          language={language}
          original={original}
          modified={modified}
          theme="vs-dark"
          options={{
            renderSideBySide: true,
            minimap: { enabled: false },
            wordWrap: "on",
            scrollBeyondLastLine: false,
            fontSize: 13,
            renderOverviewRuler: true,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
