import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Route } from "lucide-react";
import { updateRoutingOverrides } from "@/lib/api";
import type { RoutingConfig } from "@/lib/api";
import { toast } from "sonner";

interface RoutingCardProps {
    routingConfig: RoutingConfig | undefined;
    models: string[];
    onRefetch: () => void;
}

const ROUTE_INTENTS = ["code", "debug", "explain", "design", "default"];

export default function RoutingCard({ routingConfig, models, onRefetch }: RoutingCardProps) {
    const [routeDraft, setRouteDraft] = useState<Record<string, string>>({});

    const updateMut = useMutation({
        mutationFn: updateRoutingOverrides,
        onSuccess: () => { toast.success("Routing overrides updated"); onRefetch(); },
        onError: () => toast.error("Failed to update routing overrides"),
    });

    return (
        <Card className="border-[#1e1e1e] bg-[#111111]">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-200">
                    <Route className="h-5 w-5 text-violet-500" />
                    Multi-Model Routing
                </CardTitle>
                <CardDescription className="text-gray-500">
                    Map intents to preferred local models. Message routing uses these overrides first.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-3">
                    {ROUTE_INTENTS.map((intent) => (
                        <div key={intent} className="grid grid-cols-[120px,1fr] items-center gap-3">
                            <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
                                {intent}
                            </label>
                            <select
                                value={routeDraft[intent] || routingConfig?.effective_routing?.[intent] || ""}
                                onChange={(e) =>
                                    setRouteDraft((prev) => ({ ...prev, [intent]: e.target.value }))
                                }
                                className="h-9 rounded border border-[#262626] bg-[#161616] px-2 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none"
                            >
                                {(models.length > 0 ? models : routingConfig?.available_models || []).map(
                                    (model) => (
                                        <option key={`${intent}-${model}`} value={model}>
                                            {model}
                                        </option>
                                    )
                                )}
                            </select>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        onClick={() => updateMut.mutate(routeDraft)}
                        disabled={updateMut.isPending}
                        className="bg-violet-600 text-white hover:bg-violet-700"
                    >
                        Save Routing
                    </Button>
                    <Button
                        variant="outline"
                        onClick={onRefetch}
                        className="border-[#262626] bg-[#161616] text-gray-300 hover:bg-[#1e1e1e]"
                    >
                        Reload
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
