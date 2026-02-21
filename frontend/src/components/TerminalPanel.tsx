import { useEffect, useRef, useState } from 'react';
import { Terminal, Play, Square, Eraser, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTerminalSocket } from '@/lib/useTerminalSocket';
import Ansi from 'ansi-to-html';

const converter = new Ansi({
  fg: '#e5e7eb',
  bg: '#0d0d0d',
  newline: true,
  escapeXML: true,
});

interface TerminalPanelProps {
  projectId: string;
}

export function TerminalPanel({ projectId }: TerminalPanelProps) {
  const {
    output,
    isConnected,
    isRunning,
    detectedPort,
    sendCommand,
    killProcess,
    clearOutput
  } = useTerminalSocket(projectId);

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    sendCommand(input);
    setHistory(prev => [...prev, input]);
    setHistoryIndex(-1);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex + 1;
        if (newIndex < history.length) {
          setHistoryIndex(newIndex);
          setInput(history[history.length - 1 - newIndex]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const runQuickCommand = (cmd: string) => {
    sendCommand(cmd);
  };

  return (
    <div className="flex h-full flex-col border-l border-white/10 bg-slate-950/60 font-mono text-sm text-slate-300">
      {/* Toolbar */}
      <div className="panel-header flex items-center justify-between border-b border-white/10 bg-slate-900/70 p-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-300" />
          <span className="text-xs font-medium text-slate-400">TERMINAL</span>
          {isConnected ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-emerald-500 font-medium">Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] text-red-500 font-medium">Disconnected</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-xs gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
              onClick={killProcess}
            >
              <Square className="w-3 h-3 fill-current" />
              Stop Process
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-500 hover:bg-slate-800/70 hover:text-slate-300"
            onClick={clearOutput}
            title="Clear Terminal"
          >
            <Eraser className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Detected Port Banner */}
      {detectedPort && isRunning && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-2 flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-emerald-400 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            App running at localhost:{detectedPort}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 gap-1"
            onClick={() => {
              const opened = window.open(
                `http://localhost:${detectedPort}`,
                '_blank',
                'noopener,noreferrer'
              );
              if (opened) opened.opener = null;
            }}
          >
            Open Browser <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Quick Actions */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b border-white/10 p-2">
        <QuickActionButton label="npm install" onClick={() => runQuickCommand('npm install')} />
        <QuickActionButton label="npm run dev" onClick={() => runQuickCommand('npm run dev')} icon={<Play className="w-3 h-3" />} />
        <QuickActionButton label="npm run build" onClick={() => runQuickCommand('npm run build')} />
        <QuickActionButton label="ls -la" onClick={() => runQuickCommand('ls -la')} />
      </div>

      {/* Output Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-5 space-y-0.5 min-h-0"
        onClick={() => inputRef.current?.focus()}
      >
        {output.map((line, i) => (
          <div key={i} className="break-all whitespace-pre-wrap">
            {line.type === 'stdout' && (
              <span dangerouslySetInnerHTML={{ __html: converter.toHtml(line.content) }} />
            )}
            {line.type === 'stderr' && (
              <span className="text-red-400" dangerouslySetInnerHTML={{ __html: converter.toHtml(line.content) }} />
            )}
            {line.type === 'info' && (
              <span className="text-blue-400 font-bold opacity-80">{line.content}</span>
            )}
            {line.type === 'success' && (
              <span className="text-emerald-400 font-bold">{line.content}</span>
            )}
            {line.type === 'error' && (
              <span className="text-red-500 font-bold bg-red-500/10 px-1 rounded">{line.content}</span>
            )}
          </div>
        ))}
        {output.length === 0 && (
          <div className="mt-4 text-center text-xs italic text-slate-600">
            Terminal ready. Run a command to get started.
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-white/10 bg-slate-900/70 p-2">
        <span className="select-none font-bold text-cyan-300">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 border-none bg-transparent font-mono text-[13px] text-slate-200 outline-none placeholder:text-slate-600"
          placeholder="Type a command..."
          autoComplete="off"
        />
      </form>
    </div>
  );
}

function QuickActionButton({ label, onClick, icon }: { label: string, onClick: () => void, icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="whitespace-nowrap rounded border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-cyan-400/40 hover:bg-slate-700/70 hover:text-cyan-300"
    >
      {icon}
      {label}
    </button>
  );
}
