import { useQuery } from "@tanstack/react-query";
import { listProviders } from "@/lib/api";
import { useBuilderStore } from "@/store/builderStore";
import { ChevronDown, Box } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export default function ModelPicker() {
  const { data: providersData } = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
    refetchInterval: 30000,
  });

  const setSelectedModel = useBuilderStore((s) => s.setSelectedModel);
  const selectedProviderId = useBuilderStore((s) => s.selectedProviderId);
  const setSelectedProviderId = useBuilderStore((s) => s.setSelectedProviderId);

  const providers = providersData?.providers || [];
  const hasAnyOptions = providers.length > 0;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const currentModel = selectedProvider
    ? `${selectedProvider.name} · ${selectedProvider.model}`
    : "No provider selected";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-2 border-white/10 bg-slate-900/70 text-xs text-slate-300 transition-all hover:border-cyan-400/40 hover:bg-slate-800/70 hover:text-slate-100"
        >
          <Box className="h-3.5 w-3.5 text-cyan-300" />
          <span className="truncate max-w-[120px]">{currentModel}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 border-white/10 bg-slate-900/95 p-1 text-slate-300 backdrop-blur-md"
      >
        {!hasAnyOptions ? (
          <div className="px-2 py-2 text-xs text-gray-500 text-center">
            No providers found
          </div>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => {
                setSelectedModel("");
                setSelectedProviderId(null);
              }}
              className="cursor-pointer rounded-sm text-xs focus:bg-cyan-500/10 focus:text-cyan-300"
            >
              Clear Selection
            </DropdownMenuItem>
            {providers.length > 0 ? (
              <>
                <div className="my-1 border-t border-[#262626]" />
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">
                  Connected Providers
                </div>
                {providers.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => {
                      setSelectedProviderId(provider.id);
                      setSelectedModel("");
                    }}
                    className="text-xs focus:bg-cyan-500/10 focus:text-cyan-300 cursor-pointer rounded-sm"
                  >
                    {provider.name} - {provider.model}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
