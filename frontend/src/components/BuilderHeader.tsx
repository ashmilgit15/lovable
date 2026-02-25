import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  Settings,
  ChevronLeft,
  Download,
  Loader2,
  Pencil,
} from "lucide-react";

import ModelPicker from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProject } from "@/lib/api";
import { authHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/backend";
import { cn } from "@/lib/utils";

interface BuilderHeaderProps {
  projectId: string;
  projectName: string;
  connected: boolean;
  reconnecting: boolean;
}

export default function BuilderHeader({
  projectId,
  projectName,
  connected,
  reconnecting
}: BuilderHeaderProps) {
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(projectName);
  const [isExporting, setIsExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update local state when prop changes (unless editing)
  useEffect(() => {
    if (!isEditing) {
      setEditedName(projectName);
    }
  }, [projectName, isEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleRename = async () => {
    if (!editedName.trim() || editedName === projectName) {
      setIsEditing(false);
      setEditedName(projectName);
      return;
    }

    try {
      await updateProject(projectId, { name: editedName });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to rename project:", error);
      setEditedName(projectName);
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditedName(projectName);
    }
  };

  const handleExport = async () => {
    if (!projectId) return;

    setIsExporting(true);
    try {
      const auth = await authHeaders();
      const response = await fetch(apiUrl(`/api/projects/${projectId}/export`), {
        headers: auth,
      });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, "_")}_export.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export project");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="panel-header relative z-20 flex h-[54px] items-center justify-between border-b border-white/10 bg-slate-950/40 px-4 backdrop-blur-xl">
      {/* Left: Logo & Back */}
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-100 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <div className="flex items-center gap-1.5 select-none">
          <div className="rounded-md bg-gradient-to-br from-cyan-400 to-emerald-500 p-1 shadow-lg shadow-cyan-900/30">
            <Zap className="h-3 w-3 text-white fill-current" />
          </div>
          <span className="font-bold text-sm tracking-tight text-slate-100">
            one
          </span>
        </div>
      </div>

      {/* Center: Project Name */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 flex items-center gap-2">
        {isEditing ? (
          <div className="flex items-center">
            <Input
              ref={inputRef}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleRename}
              className="h-7 w-[220px] text-center bg-slate-900/70 border-cyan-500/40 focus-visible:ring-cyan-400/40 text-sm text-slate-100"
            />
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-800/60 transition-colors"
          >
            <span className="font-medium text-sm text-slate-200">{projectName}</span>
            <Pencil className="h-3 w-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        {/* Connection Status (Hidden on small screens, or subtle) */}
        <div className={cn(
          "flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors",
          reconnecting
            ? "bg-amber-500/10 text-amber-300"
            : connected
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
        )}>
          <div className={cn(
            "h-1.5 w-1.5 rounded-full",
            reconnecting ? "bg-yellow-500" : connected ? "bg-emerald-500" : "bg-red-500"
          )} />
          <span className="hidden sm:inline">
            {reconnecting ? "Reconnecting" : connected ? "Online" : "Offline"}
          </span>
        </div>

        <div className="mx-1 h-4 w-[1px] bg-white/15" />

        <ModelPicker />

        <div className="mx-1 h-4 w-[1px] bg-white/15" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
          onClick={handleExport}
          disabled={isExporting}
          title="Export Project (ZIP)"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>

        <Link to={`/settings?projectId=${projectId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60">
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
