import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserButton } from "@clerk/clerk-react";
import { useNavigate, Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  listProjects,
  createProject,
  createProjectFromTemplate,
  deleteProject,
  listTemplates,
} from "@/lib/api";
import { BUILDER_TEMPLATES } from "@/data/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Bolt,
  FolderKanban,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { CLERK_ENABLED } from "@/lib/clerkConfig";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const { data: templatesFromApi } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialogOpen(false);
      setName("");
      setDescription("");
      navigate(`/builder/${project.id}`);
    },
    onError: () => {
      toast.error("Unable to create project");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
    onError: () => {
      toast.error("Unable to delete project");
    },
  });

  const createFromTemplateMutation = useMutation({
    mutationFn: createProjectFromTemplate,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      sessionStorage.setItem(`forge:template-prompt:${result.project.id}`, result.initial_prompt);
      navigate(`/builder/${result.project.id}`);
    },
    onError: () => toast.error("Failed to create project from template"),
    onSettled: () => setCreatingTemplateId(null),
  });

  const mergedTemplates = useMemo(() => {
    const customTemplates = templatesFromApi?.filter((template) => !template.is_builtin) || [];
    return [
      ...BUILDER_TEMPLATES.map((template) => ({
        ...template,
        is_builtin: true,
      })),
      ...customTemplates,
    ];
  }, [templatesFromApi]);

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (project.description && project.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [projects, searchQuery]);

  const lastUpdated = useMemo(() => {
    if (!projects || projects.length === 0) return "No activity yet";
    const newest = [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
    return formatDistanceToNow(new Date(newest.updated_at), { addSuffix: true });
  }, [projects]);

  const handleCreateFromTemplate = (template: {
    id: string;
    name: string;
    prompt: string;
  }) => {
    setCreatingTemplateId(template.id);
    createFromTemplateMutation.mutate({
      name: `${template.name} Project`,
      prompt: template.prompt,
    });
  };

  return (
    <div className="app-shell relative flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/8 bg-slate-950/60 px-4 backdrop-blur-2xl sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-500 p-1.5 shadow-lg shadow-cyan-500/30">
            <Bolt className="h-4 w-4 fill-current text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-100">
            One<span className="gradient-text">Forge</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link to="/settings">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </Link>
          {CLERK_ENABLED ? <UserButton /> : null}
        </div>
      </header>

      <main className="relative z-10 flex-1 px-4 pb-10 pt-8 sm:px-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <section className="panel-surface rounded-2xl p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Project <span className="gradient-text">Workspace</span></h1>
                <p className="mt-1 text-sm text-slate-400">Create, iterate, and ship projects with AI-assisted workflows.</p>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
                <div className="relative flex-1 sm:min-w-[260px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    placeholder="Search projects"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="h-10 border-white/15 bg-slate-900/70 pl-9 text-slate-200 focus-visible:ring-cyan-400/40"
                  />
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="h-10 gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-400 hover:to-emerald-400 shadow-md shadow-cyan-500/20">
                      <Plus className="h-4 w-4" /> New Project
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-white/10 bg-slate-950 text-slate-100 sm:max-w-[430px]">
                    <DialogHeader>
                      <DialogTitle>Create New Project</DialogTitle>
                      <DialogDescription className="text-slate-400">
                        Start with an empty workspace and prompt the assistant to scaffold your app.
                      </DialogDescription>
                    </DialogHeader>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!name.trim()) return;
                        createMutation.mutate({
                          name: name.trim(),
                          description: description.trim() || undefined,
                        });
                      }}
                      className="mt-4 space-y-4"
                    >
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-400">Project name</label>
                        <Input
                          placeholder="Acme marketing site"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          autoFocus
                          className="border-white/15 bg-slate-900/80 text-slate-100 focus-visible:ring-cyan-400/40"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          Description (optional)
                        </label>
                        <Textarea
                          placeholder="What are you building?"
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          rows={3}
                          className="resize-none border-white/15 bg-slate-900/80 text-slate-100 focus-visible:ring-cyan-400/40"
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          type="submit"
                          className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                          disabled={!name.trim() || createMutation.isPending}
                        >
                          {createMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Create Project
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="glass-card rounded-xl p-4 transition-transform duration-300 hover:scale-[1.02]">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Total Projects</p>
                <p className="mt-1 text-2xl font-bold gradient-text">{projects?.length || 0}</p>
              </div>
              <div className="glass-card rounded-xl p-4 transition-transform duration-300 hover:scale-[1.02]">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Search Results</p>
                <p className="mt-1 text-2xl font-bold text-slate-100">{filteredProjects.length}</p>
              </div>
              <div className="glass-card rounded-xl p-4 transition-transform duration-300 hover:scale-[1.02]">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Latest Activity</p>
                <p className="mt-1 text-sm font-semibold text-cyan-300">{lastUpdated}</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              <h2 className="text-xl font-semibold text-slate-100">Start From Template</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {mergedTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() =>
                    handleCreateFromTemplate({
                      id: template.id,
                      name: template.name,
                      prompt: template.prompt,
                    })
                  }
                  disabled={createFromTemplateMutation.isPending}
                  className="group glass-card rounded-xl p-4 text-left transition-all duration-300 hover:border-cyan-300/25 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="inline-flex rounded-md border border-cyan-300/30 bg-cyan-400/10 p-2 text-cyan-200">
                      <Workflow className="h-4 w-4" />
                    </div>
                    {creatingTemplateId === template.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                    ) : null}
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-100">{template.name}</h3>
                  <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-slate-400">{template.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {(template.tags || []).slice(0, 3).map((tag: string) => (
                      <span
                        key={`${template.id}-${tag}`}
                        className="rounded border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-cyan-300" />
              <h2 className="text-xl font-semibold text-slate-100">Your Projects</h2>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-48 animate-pulse rounded-xl border border-white/10 bg-slate-900/50"
                  />
                ))}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="panel-surface flex flex-col items-center justify-center rounded-xl border-dashed py-20 text-center">
                <div className="mb-4 rounded-full border border-white/10 bg-slate-900/70 p-3">
                  <FolderKanban className="h-7 w-7 text-slate-500" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-100">No projects found</h3>
                <p className="mb-6 max-w-sm text-sm text-slate-400">
                  {searchQuery
                    ? "Try a different query or clear filters."
                    : "Create a new project or use a template to get started."}
                </p>
                {!searchQuery ? (
                  <Button onClick={() => setDialogOpen(true)} className="gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-400 hover:to-emerald-400 shadow-md shadow-cyan-500/20">
                    <Plus className="h-4 w-4" /> Create Project
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative flex flex-col justify-between glass-card rounded-xl p-5 transition-all duration-300 hover:border-cyan-300/25 hover:scale-[1.01]"
                  >
                    <div className="mb-4">
                      <div className="mb-2 flex items-start justify-between">
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-400/10">
                          <FolderKanban className="h-5 w-5 text-cyan-200" />
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:bg-slate-800/70 hover:text-slate-100"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-white/10 bg-slate-900 text-slate-200">
                            <DropdownMenuItem
                              className="cursor-pointer text-red-300 focus:bg-red-500/20 focus:text-red-200"
                              onClick={() => {
                                if (confirm("Are you sure? This will delete all files.")) {
                                  deleteMutation.mutate(project.id);
                                }
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <h3 className="mb-1 line-clamp-1 text-lg font-semibold text-slate-100">{project.name}</h3>
                      <p className="min-h-[40px] line-clamp-2 text-sm text-slate-400">
                        {project.description || "No description provided"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="text-xs font-medium text-slate-500">
                        Updated {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-cyan-200 hover:bg-cyan-400/10 hover:text-cyan-100"
                        onClick={() => navigate(`/builder/${project.id}`)}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
