import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, RefreshCw } from "lucide-react";

interface OllamaConnectionCardProps {
    status: { status: string; url: string } | undefined;
    isRefetching: boolean;
    onRefresh: () => void;
}

export default function OllamaConnectionCard({
    status,
    isRefetching,
    onRefresh,
}: OllamaConnectionCardProps) {
    const isConnected = status?.status === "connected";

    return (
        <Card className="border-[#1e1e1e] bg-[#111111]">
            <CardHeader>
                <CardTitle className="flex items-center justify-between text-gray-200">
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-violet-500" />
                        Ollama Connection
                    </div>
                    <Badge
                        variant={isConnected ? "default" : "destructive"}
                        className={
                            isConnected
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                                : ""
                        }
                    >
                        {isConnected ? "Connected" : "Disconnected"}
                    </Badge>
                </CardTitle>
                <CardDescription className="text-gray-500">
                    Ollama URL:{" "}
                    <code className="rounded bg-[#161616] px-1 py-0.5 text-gray-400">
                        {status?.url || "http://localhost:11434"}
                    </code>
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-[#222] bg-[#161616] text-gray-300 hover:border-[#333] hover:bg-[#222] hover:text-white"
                    onClick={onRefresh}
                    disabled={isRefetching}
                >
                    <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
                    Check Connection
                </Button>
            </CardContent>
        </Card>
    );
}
