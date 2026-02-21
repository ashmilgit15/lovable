import { useQuery } from "@tanstack/react-query";
import { getOllamaStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function OllamaStatus({ className }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ["ollama-status"],
    queryFn: getOllamaStatus,
    refetchInterval: 10000,
  });

  const isConnected = data?.status === "connected";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-all duration-300",
        isConnected
          ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
          : "border-red-500/20 bg-red-500/10 text-red-400",
        className
      )}
      title={isConnected ? `Connected to ${data?.url}` : "Ollama disconnected"}
    >
      <div className="relative flex h-2 w-2">
        {isConnected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-300 opacity-75"></span>
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isConnected ? "bg-cyan-300" : "bg-red-500"
          )}
        ></span>
      </div>
      <span className="hidden sm:inline">Ollama</span>
    </div>
  );
}
