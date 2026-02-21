import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { PlugZap, RefreshCw, Cpu, Globe, KeyRound, Trash } from "lucide-react";
import { createProvider, activateProvider, deleteProvider } from "@/lib/api";
import type { ProviderData, ProviderPreset } from "@/lib/api";
import { toast } from "sonner";

const FALLBACK_PROVIDER_PRESETS: Record<string, { label: string; base_url: string }> = {
    openai: { label: "OpenAI", base_url: "https://api.openai.com/v1" },
    openrouter: { label: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
    groq: { label: "Groq", base_url: "https://api.groq.com/openai/v1" },
    together: { label: "Together", base_url: "https://api.together.xyz/v1" },
    custom_openai: { label: "Custom (OpenAI-compatible)", base_url: "" },
};

interface ProviderCardProps {
    providers: ProviderData[];
    presets: Record<string, ProviderPreset> | undefined;
    onRefetch: () => void;
}

export default function ProviderCard({ providers, presets, onRefetch }: ProviderCardProps) {
    const [draft, setDraft] = useState({
        name: "",
        provider: "openai",
        model: "",
        apiKey: "",
        baseUrl: "",
        isActive: true,
    });

    const providerPresets = presets || FALLBACK_PROVIDER_PRESETS;

    const createMut = useMutation({
        mutationFn: createProvider,
        onSuccess: () => {
            toast.success("Provider connected");
            setDraft((p) => ({ ...p, name: "", model: "", apiKey: "", baseUrl: "" }));
            onRefetch();
        },
        onError: () => toast.error("Failed to connect provider"),
    });

    const activateMut = useMutation({
        mutationFn: activateProvider,
        onSuccess: () => { toast.success("Provider activated"); onRefetch(); },
        onError: () => toast.error("Failed to activate provider"),
    });

    const deleteMut = useMutation({
        mutationFn: deleteProvider,
        onSuccess: () => { toast.success("Provider removed"); onRefetch(); },
        onError: () => toast.error("Failed to remove provider"),
    });

    const handleConnect = () => {
        if (!draft.name.trim()) { toast.error("Provider name is required"); return; }
        if (!draft.model.trim()) { toast.error("Provider model is required"); return; }
        if (!draft.apiKey.trim()) { toast.error("API key is required"); return; }
        createMut.mutate({
            name: draft.name.trim(),
            provider: draft.provider,
            model: draft.model.trim(),
            api_key: draft.apiKey.trim(),
            base_url: draft.baseUrl.trim() || undefined,
            is_active: draft.isActive,
        });
    };

    return (
        <Card className="border-[#1e1e1e] bg-[#111111]">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-200">
                    <PlugZap className="h-5 w-5 text-cyan-400" />
                    Connect Provider
                </CardTitle>
                <CardDescription className="text-gray-500">
                    Use external model APIs (OpenAI-compatible) alongside local Ollama models.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wider text-gray-500">Provider Name</label>
                        <Input
                            placeholder="e.g. OpenRouter Team"
                            value={draft.name}
                            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                            className="border-[#222] bg-[#161616] text-gray-200 focus:border-cyan-500/50"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wider text-gray-500">Provider Type</label>
                        <select
                            value={draft.provider}
                            onChange={(e) => {
                                const provider = e.target.value;
                                const defaultBase = providerPresets[provider]?.base_url || "";
                                setDraft((p) => ({ ...p, provider, baseUrl: defaultBase || p.baseUrl }));
                            }}
                            className="h-9 w-full rounded border border-[#262626] bg-[#161616] px-2 text-sm text-gray-200 focus:border-cyan-500/50 focus:outline-none"
                        >
                            {Object.entries(providerPresets).map(([key, preset]) => (
                                <option key={key} value={key}>{preset.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wider text-gray-500">Default Model</label>
                        <Input
                            placeholder="e.g. gpt-4o-mini"
                            value={draft.model}
                            onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))}
                            className="border-[#222] bg-[#161616] text-gray-200 focus:border-cyan-500/50"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wider text-gray-500">Base URL</label>
                        <Input
                            placeholder="https://api.provider.com/v1"
                            value={draft.baseUrl}
                            onChange={(e) => setDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                            className="border-[#222] bg-[#161616] text-gray-200 focus:border-cyan-500/50"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs uppercase tracking-wider text-gray-500">API Key</label>
                    <Input
                        type="password"
                        placeholder="Paste provider API key"
                        value={draft.apiKey}
                        onChange={(e) => setDraft((p) => ({ ...p, apiKey: e.target.value }))}
                        className="border-[#222] bg-[#161616] text-gray-200 focus:border-cyan-500/50"
                    />
                </div>

                <div className="flex items-center justify-between rounded border border-[#222] bg-[#161616] px-3 py-2">
                    <div className="text-xs text-gray-400">Set as active provider</div>
                    <Button
                        size="sm"
                        variant={draft.isActive ? "default" : "outline"}
                        className={
                            draft.isActive
                                ? "bg-cyan-600 text-white hover:bg-cyan-700"
                                : "border-[#2a2a2a] bg-[#111] text-gray-300 hover:bg-[#1e1e1e]"
                        }
                        onClick={() => setDraft((p) => ({ ...p, isActive: !p.isActive }))}
                    >
                        {draft.isActive ? "Active on connect" : "Inactive on connect"}
                    </Button>
                </div>

                <Button
                    onClick={handleConnect}
                    disabled={createMut.isPending}
                    className="w-full bg-cyan-600 text-white hover:bg-cyan-700"
                >
                    {createMut.isPending ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <PlugZap className="mr-2 h-4 w-4" />
                    )}
                    Connect Provider
                </Button>

                <Separator className="bg-[#1e1e1e]" />

                <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-300">Connected Providers</h3>
                    {providers.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#222] bg-[#161616]/50 p-4 text-xs text-gray-500">
                            No external providers connected yet.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {providers.map((provider) => (
                                <div
                                    key={provider.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#242424] bg-[#161616] px-3 py-2"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Cpu className="h-4 w-4 text-cyan-300" />
                                            <p className="truncate text-sm font-medium text-gray-200">{provider.name}</p>
                                            {provider.is_active ? (
                                                <Badge className="border-cyan-500/30 bg-cyan-500/15 text-cyan-300">Active</Badge>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                            <Globe className="h-3 w-3" />
                                            <span>{provider.provider}</span>
                                            <span>•</span>
                                            <span className="truncate">{provider.model}</span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                                            <KeyRound className="h-3 w-3" />
                                            <span>{provider.api_key_masked || "No key"}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!provider.is_active ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                                                onClick={() => activateMut.mutate(provider.id)}
                                                disabled={activateMut.isPending}
                                            >
                                                Activate
                                            </Button>
                                        ) : null}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                                            onClick={() => deleteMut.mutate(provider.id)}
                                            disabled={deleteMut.isPending}
                                        >
                                            <Trash className="mr-1 h-3.5 w-3.5" />
                                            Remove
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
