import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronLeft, ChevronRight, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getGenerationHistory, getGenerationSnapshots } from "@/lib/api";

interface VersionHistoryProps {
  projectId: string;
  onRestore: (files: Array<{ filename: string; content: string }>) => Promise<void>;
}

export default function VersionHistory({ projectId, onRestore }: VersionHistoryProps) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["generation-history", projectId],
    queryFn: () => getGenerationHistory(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30000,
  });

  const generations = data?.generations || [];
  const hasGenerations = generations.length > 0;
  const canExpand = hasGenerations || isFetching;

  const handleRestore = async (generationId: string) => {
    try {
      setRestoringId(generationId);
      const payload = await getGenerationSnapshots(projectId, generationId);
      await onRestore(
        payload.snapshots.map((snapshot) => ({
          filename: snapshot.filename,
          content: snapshot.content || "",
        }))
      );
      await refetch();
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-white/10 bg-slate-950/45 transition-all duration-200",
        collapsed ? "w-[42px]" : "w-[250px]"
      )}
    >
      <div className="panel-header flex h-[40px] shrink-0 items-center justify-between border-b border-white/10 px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-3.5 w-3.5 text-cyan-300" />
          {!collapsed ? (
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">
              History
            </span>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
          onClick={() => setCollapsed((prev) => (canExpand ? !prev : true))}
          title={collapsed ? "Expand history" : "Collapse history"}
        >
          {collapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {generations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-500">
              No generations yet
            </div>
          ) : (
            <div className="space-y-2">
              {generations.map((generation) => (
                <div
                  key={generation.id}
                  className="rounded-xl border border-white/10 bg-slate-900/60 p-2"
                >
                  <p className="line-clamp-2 text-[11px] text-slate-200">{generation.user_message}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {formatDistanceToNow(new Date(generation.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-6 w-full gap-1 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                    onClick={() => handleRestore(generation.id)}
                    disabled={restoringId === generation.id || isFetching}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {restoringId === generation.id ? "Restoring..." : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
