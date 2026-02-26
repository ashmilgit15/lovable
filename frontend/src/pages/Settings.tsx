import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { UserButton } from "@clerk/clerk-react";
import {
  getProjectMemory,
  listProjects,
  listProviders,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Settings2, Zap } from "lucide-react";
import ProviderCard from "@/components/settings/ProviderCard";
import ProjectSafetyCard from "@/components/settings/ProjectSafetyCard";
import { CLERK_ENABLED } from "@/lib/clerkConfig";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const selectedProjectId = searchParams.get("projectId") || "";

  const { data: memory, refetch: refetchMemory } = useQuery({
    queryKey: ["project-memory", selectedProjectId],
    queryFn: () => getProjectMemory(selectedProjectId),
    enabled: Boolean(selectedProjectId),
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

  const handleSelectProject = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("projectId", id);
    setSearchParams(next);
  };

  return (
    <div className="app-shell relative flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/8 bg-slate-950/60 px-6 backdrop-blur-2xl">
        <Link to="/" className="flex items-center gap-2">
          <div className="rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-500 p-1.5 shadow-lg shadow-cyan-500/30">
            <Zap className="h-4 w-4 fill-current text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-100">
            One<span className="gradient-text">Forge</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link to="/dashboard">
            <Button
              variant="ghost"
              className="gap-2 text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
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
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Workspace <span className="gradient-text">Settings</span></h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                  Configure providers and per-project safety defaults before deployment.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-6">
            <ProviderCard
              providers={providersData?.providers || []}
              presets={providersData?.presets}
              onRefetch={() => refetchProviders()}
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
