import { Users, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CollaborationUser {
  id: string;
  username: string;
  color: string;
  is_owner: boolean;
}

interface Suggestion {
  id: string;
  username: string;
  message: string;
}

interface CollaborationBarProps {
  users: CollaborationUser[];
  connected: boolean;
  isOwner: boolean;
  suggestions: Suggestion[];
  onApproveSuggestion: (suggestionId: string) => void;
}

export default function CollaborationBar({
  users,
  connected,
  isOwner,
  suggestions,
  onApproveSuggestion,
}: CollaborationBarProps) {
  return (
    <div className="panel-surface flex items-center gap-3 rounded-2xl border-white/15 bg-slate-900/55 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Users className="h-3.5 w-3.5 text-cyan-300" />
        <span>{connected ? "Collab live" : "Collab offline"}</span>
      </div>

      <div className="flex items-center -space-x-2">
        {users.slice(0, 5).map((user) => (
          <div
            key={user.id}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-900 text-[10px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: user.color }}
            title={`${user.username}${user.is_owner ? " (owner)" : ""}`}
          >
            {user.is_owner ? <Crown className="h-3 w-3" /> : user.username.slice(0, 1).toUpperCase()}
          </div>
        ))}
      </div>

      {isOwner && suggestions.length > 0 ? (
        <div className="ml-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-amber-400">
            Suggestions
          </span>
          <div className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-gray-300">
            {suggestions[0].username}: {suggestions[0].message}
          </div>
          <Button
            size="sm"
            className="h-6 bg-amber-500/20 text-[10px] text-amber-200 hover:bg-amber-500/30"
            onClick={() => onApproveSuggestion(suggestions[0].id)}
          >
            Approve
          </Button>
        </div>
      ) : null}
    </div>
  );
}
