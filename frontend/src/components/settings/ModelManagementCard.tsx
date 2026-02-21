import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Terminal, RefreshCw, Download } from "lucide-react";
import { authenticatedWsUrl } from "@/lib/auth";

interface ModelManagementCardProps {
    models: string[];
    isConnected: boolean;
    isRefetching: boolean;
    onRefresh: () => void;
}

export default function ModelManagementCard({
    models,
    isConnected,
    isRefetching,
    onRefresh,
}: ModelManagementCardProps) {
    const [pullModelName, setPullModelName] = useState("");
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState<{
        status: string;
        completed?: number;
        total?: number;
    } | null>(null);
    const pullSocketRef = useRef<WebSocket | null>(null);

    const handlePullModel = async () => {
        if (!pullModelName.trim()) return;

        setIsPulling(true);
        setPullProgress({ status: "Starting..." });

        const path = "/api/ollama/pull";
        try {
            const finalUrl = await authenticatedWsUrl(path);
            const ws = new WebSocket(finalUrl);
            pullSocketRef.current = ws;

            ws.onopen = () => {
                ws.send(JSON.stringify({ model: pullModelName }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    setPullProgress(data);

                    if (data.status === "success") {
                        setIsPulling(false);
                        setPullModelName("");
                        onRefresh();
                        ws.close();
                    } else if (data.error) {
                        setIsPulling(false);
                        setPullProgress({ status: `Error: ${data.error}` });
                        ws.close();
                    }
                } catch (e) {
                    console.error("Error parsing progress:", e);
                }
            };

            ws.onerror = () => {
                setIsPulling(false);
                setPullProgress({ status: "Connection error" });
            };

            ws.onclose = () => {
                if (isPulling) setIsPulling(false);
            };
        } catch (err) {
            console.error("Failed to start model pull:", err);
            setIsPulling(false);
            setPullProgress({ status: "Authentication error" });
        }
    };

    return (
        <Card className="border-[#1e1e1e] bg-[#111111]">
            <CardHeader>
                <CardTitle className="flex items-center justify-between text-gray-200">
                    <div className="flex items-center gap-2">
                        <Terminal className="h-5 w-5 text-violet-500" />
                        Model Management
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-gray-400 hover:text-white"
                        onClick={onRefresh}
                        disabled={isRefetching}
                    >
                        <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex gap-2">
                    <Input
                        placeholder="Model name (e.g. qwen2.5-coder:14b)"
                        value={pullModelName}
                        onChange={(e) => setPullModelName(e.target.value)}
                        className="border-[#222] bg-[#161616] text-gray-200 focus:border-violet-500/50"
                        disabled={isPulling}
                    />
                    <Button
                        onClick={handlePullModel}
                        disabled={!pullModelName.trim() || isPulling || !isConnected}
                        className="min-w-[100px] bg-violet-600 text-white hover:bg-violet-700"
                    >
                        {isPulling ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Download className="mr-2 h-4 w-4" /> Pull
                            </>
                        )}
                    </Button>
                </div>

                {pullProgress ? (
                    <div className="space-y-2 rounded-lg border border-[#222] bg-[#161616] p-4">
                        <div className="flex justify-between text-sm text-gray-300">
                            <span>{pullProgress.status}</span>
                            {pullProgress.total ? (
                                <span>
                                    {Math.round(((pullProgress.completed || 0) / (pullProgress.total || 1)) * 100)}%
                                </span>
                            ) : null}
                        </div>
                        {pullProgress.total ? (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[#222]">
                                <div
                                    className="h-full bg-violet-600 transition-all duration-300"
                                    style={{
                                        width: `${Math.round(((pullProgress.completed || 0) / (pullProgress.total || 1)) * 100)}%`,
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <Separator className="bg-[#1e1e1e]" />

                <div className="space-y-2">
                    <h3 className="mb-3 text-sm font-medium text-gray-400">Installed Models</h3>
                    {models.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#222] bg-[#161616]/50 p-8 text-center">
                            <p className="mb-2 text-sm text-gray-500">No models found</p>
                            <p className="text-xs text-gray-600">
                                Pull <code className="text-violet-400">qwen2.5-coder:7b</code> or{" "}
                                <code className="text-violet-400">mistral:7b</code>
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            {models.map((model) => (
                                <div
                                    key={model}
                                    className="flex items-center justify-between rounded-lg border border-[#222] bg-[#161616] px-4 py-3 transition-colors hover:border-violet-500/20"
                                >
                                    <span className="text-sm font-medium text-gray-200">{model}</span>
                                    <Badge variant="secondary" className="bg-[#222] text-gray-400">
                                        Ready
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
