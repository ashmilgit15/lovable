import { useBuilderStore } from "@/store/builderStore";
import { Loader2, CheckCircle2, Database } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listProviders } from "@/lib/api";

export default function StatusBar() {
  const isStreaming = useBuilderStore((s) => s.isStreaming);
  const selectedProviderId = useBuilderStore((s) => s.selectedProviderId);
  const files = useBuilderStore((s) => s.files);
  const pendingCount = useBuilderStore((s) => Object.keys(s.pendingChanges).length);
  const autoFix = useBuilderStore((s) => s.autoFix);
  const { data: providersData } = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
    refetchInterval: 30000,
  });

  const fileCount = Object.keys(files).length;
  const selectedProvider = providersData?.providers.find(
    (provider) => provider.id === selectedProviderId
  );

  return (
    <div className="relative z-20 flex min-h-7 select-none items-center border-t border-white/10 bg-slate-950/70 px-3 text-[10px] text-slate-500 backdrop-blur-xl">
      <div className="flex w-full items-center justify-between py-1 md:hidden">
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${selectedProvider ? "bg-emerald-500" : "bg-red-500"}`} />
          <span className="max-w-[130px] truncate">
            {selectedProvider ? selectedProvider.name : "No provider"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <div className="flex items-center gap-1 text-cyan-300">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              <span>Generating</span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500/50" />
              <span>Ready</span>
            </div>
          )}
          <span>{fileCount}</span>
          {autoFix.phase === "running" ? (
            <span className="text-cyan-300">Auto-fixing</span>
          ) : null}
        </div>
      </div>

      <div className="hidden w-full items-center justify-between md:flex">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 transition-colors hover:text-slate-300">
            <div className={`w-1.5 h-1.5 rounded-full ${selectedProvider ? "bg-emerald-500" : "bg-red-500"}`} />
            <span>
              {selectedProvider
                ? `${selectedProvider.name} · ${selectedProvider.model}`
                : "No provider selected"}
            </span>
          </div>

          <div className="h-3 w-[1px] bg-white/10" />

          <div className="flex items-center gap-1.5">
            {isStreaming ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                <span className="text-cyan-300">Generating...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-500/50" />
                <span>Ready</span>
              </>
            )}
          </div>

          {autoFix.phase === "running" ? (
            <>
              <div className="h-3 w-[1px] bg-[#1e1e1e]" />
              <div className="flex items-center gap-1.5 text-cyan-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Auto-fixing</span>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 transition-colors hover:text-slate-300">
            <Database className="w-3 h-3" />
            <span>SQLite</span>
          </div>

          <div className="h-3 w-[1px] bg-white/10" />

          <div>
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </div>

          {pendingCount > 0 ? (
            <>
              <div className="h-3 w-[1px] bg-white/10" />
              <div className="text-cyan-300">{pendingCount} pending changes</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
