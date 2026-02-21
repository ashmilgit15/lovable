import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { UserButton } from "@clerk/clerk-react";
import {
  getOllamaModels,
  getOllamaStatus,
  getProjectMemory,
  getRoutingConfig,
  listProjects,
  listProviders,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Settings2, Zap } from "lucide-react";
import OllamaStatus from "@/components/OllamaStatus";
import OllamaConnectionCard from "@/components/settings/OllamaConnectionCard";
import ProviderCard from "@/components/settings/ProviderCard";
import ModelManagementCard from "@/components/settings/ModelManagementCard";
import RoutingCard from "@/components/settings/RoutingCard";
import ProjectSafetyCard from "@/components/settings/ProjectSafetyCard";
import { CLERK_ENABLED } from "@/lib/clerkConfig";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: status, refetch: refetchStatus, isRefetching: statusRefetching } = useQuery({
    queryKey: ["ollama-status"],
    queryFn: getOllamaStatus,
  });

  const { data: modelsData, refetch: refetchModels, isRefetching: modelsRefetching } = useQuery({
    queryKey: ["ollama-models"],
    queryFn: getOllamaModels,
  });

  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const selectedProjectId = searchParams.get("projectId") || "";

  const { data: memory, refetch: refetchMemory } = useQuery({
    queryKey: ["project-memory", selectedProjectId],
    queryFn: () => getProjectMemory(selectedProjectId),
    enabled: Boolean(selectedProjectId),
  });

  const { data: routingConfig, refetch: refetchRouting } = useQuery({
    queryKey: ["routing-config"],
    queryFn: getRoutingConfig,
  });

  const { data: providersData, refetch: refetchProviders } = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  useEffect(() => {
    if (!selectedProjectId && projects && projects.length > 0) {
      const next = new URLSearchParams(searchParams);
      next.set("projectId", projects[0].id);
      setSearchParams(next);
    }
  }, [projects, searchParams, selectedProjectId, setSearchParams]);

  const selectedProject = useMemo(
    () => projects?.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const isConnected = status?.status === "connected";
  const models = modelsData?.models || [];

  const handleSelectProject = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("projectId", id);
    setSearchParams(next);
  };

  return (
    <div className="app-shell relative flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-cyan-400 to-emerald-500 p-1.5 shadow-lg shadow-cyan-900/30">
            <Zap className="h-4 w-4 fill-current text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-100">
            lovable <span className="text-cyan-300">local</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <OllamaStatus className="hidden md:flex" />
          <Link to="/dashboard">
            <Button
              variant="ghost"
              className="gap-2 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
          {CLERK_ENABLED ? <UserButton /> : null}
        </div>
      </header>

      <main className="relative z-10 flex-1 px-6 pb-10 pt-8 sm:px-10">
        <div className="mx-auto max-w-5xl space-y-8">
          <section className="panel-surface rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-2.5">
                <Settings2 className="h-5 w-5 text-cyan-200" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-100">Workspace Settings</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                  Configure providers, models, routing policy, and per-project safety defaults before deployment.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-6">
            <OllamaConnectionCard
              status={status}
              isRefetching={statusRefetching}
              onRefresh={() => refetchStatus()}
            />
            <ProviderCard
              providers={providersData?.providers || []}
              presets={providersData?.presets}
              onRefetch={() => refetchProviders()}
            />
            <ModelManagementCard
              models={models}
              isConnected={isConnected}
              isRefetching={modelsRefetching}
              onRefresh={() => refetchModels()}
            />
            <RoutingCard
              routingConfig={routingConfig}
              models={models}
              onRefetch={() => refetchRouting()}
            />
            <ProjectSafetyCard
              projects={projects || []}
              selectedProjectId={selectedProjectId}
              selectedProject={selectedProject}
              onSelectProject={handleSelectProject}
              memory={memory}
              onRefreshMemory={() => refetchMemory()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
