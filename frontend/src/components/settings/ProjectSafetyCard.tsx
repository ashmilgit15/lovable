import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldCheck, Brain, RefreshCw, Trash2 } from "lucide-react";
import { updateProject, clearProjectMemory } from "@/lib/api";
import type { ProjectData, MemoryData } from "@/lib/api";
import { toast } from "sonner";

interface ProjectSafetyCardProps {
    projects: ProjectData[];
    selectedProjectId: string;
    selectedProject: ProjectData | undefined;
    onSelectProject: (id: string) => void;
    memory: MemoryData | undefined;
    onRefreshMemory: () => void;
}

export default function ProjectSafetyCard({
    projects,
    selectedProjectId,
    selectedProject,
    onSelectProject,
    memory,
    onRefreshMemory,
}: ProjectSafetyCardProps) {
    const queryClient = useQueryClient();

    const updateProjectMut = useMutation({
        mutationFn: ({ projectId, autoFix }: { projectId: string; autoFix: boolean }) =>
            updateProject(projectId, { auto_fix_enabled: autoFix }),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            queryClient.invalidateQueries({ queryKey: ["project", variables.projectId] });
            toast.success("Project settings updated");
        },
        onError: () => toast.error("Failed to update project settings"),
    });

    const clearMemoryMut = useMutation({
        mutationFn: () => clearProjectMemory(selectedProjectId),
        onSuccess: () => {
            toast.success("Memory cleared");
            queryClient.invalidateQueries({ queryKey: ["project-memory", selectedProjectId] });
        },
    });

    return (
        <>
            <Card className="border-[#1e1e1e] bg-[#111111]">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-200">
                        <ShieldCheck className="h-5 w-5 text-violet-500" />
                        Project Safety
                    </CardTitle>
                    <CardDescription className="text-gray-500">
                        Enable or disable automatic TypeScript/runtime fixes for the selected project.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <label className="block text-xs uppercase tracking-wider text-gray-500">Project</label>
                    <select
                        value={selectedProjectId}
                        onChange={(e) => onSelectProject(e.target.value)}
                        className="h-9 w-full rounded border border-[#262626] bg-[#161616] px-2 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none"
                    >
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.name}
                            </option>
                        ))}
                    </select>

                    {selectedProject ? (
                        <div className="flex items-center justify-between rounded border border-[#222] bg-[#161616] px-3 py-2">
                            <div>
                                <p className="text-sm text-gray-200">Auto-fix errors</p>
                                <p className="text-xs text-gray-500">
                                    Runs `tsc --noEmit` after generation and applies fixes automatically.
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant={selectedProject.auto_fix_enabled ? "default" : "outline"}
                                className={
                                    selectedProject.auto_fix_enabled
                                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                        : "border-[#2a2a2a] bg-[#111] text-gray-300 hover:bg-[#1e1e1e]"
                                }
                                onClick={() =>
                                    updateProjectMut.mutate({
                                        projectId: selectedProject.id,
                                        autoFix: !selectedProject.auto_fix_enabled,
                                    })
                                }
                                disabled={updateProjectMut.isPending}
                            >
                                {selectedProject.auto_fix_enabled ? "Enabled" : "Disabled"}
                            </Button>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card className="border-[#1e1e1e] bg-[#111111]">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-200">
                        <Brain className="h-5 w-5 text-violet-500" />
                        Project Memory
                    </CardTitle>
                    <CardDescription className="text-gray-500">
                        Persistent context from <code>generated/&lt;project_id&gt;/memory.json</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="border-[#262626] bg-[#161616] text-gray-300 hover:bg-[#1e1e1e]"
                            onClick={onRefreshMemory}
                            disabled={!selectedProjectId}
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Refresh
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            className="bg-red-500/20 text-red-300 hover:bg-red-500/30"
                            onClick={() => clearMemoryMut.mutate()}
                            disabled={!selectedProjectId || clearMemoryMut.isPending}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Clear Memory
                        </Button>
                    </div>
                    <pre className="max-h-[360px] overflow-auto rounded-lg border border-[#222] bg-[#0f0f0f] p-4 text-xs text-gray-300">
                        {JSON.stringify(memory || { message: "Select a project to inspect memory." }, null, 2)}
                    </pre>
                </CardContent>
            </Card>
        </>
    );
}
