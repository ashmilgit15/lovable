import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  FolderOpen,
  Folder,
  FileJson,
  FileType,
  FileText,
  Plus,
  File
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileData } from "@/store/builderStore";
import { Button } from "@/components/ui/button";

interface FileTreeProps {
  files: Record<string, FileData>;
  activeFile: string | null;
  onSelectFile: (filename: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: Record<string, TreeNode>;
  isFile: boolean;
}

function buildTree(files: Record<string, FileData>): TreeNode {
  const root: TreeNode = { name: "", path: "", children: {}, isFile: false };

  // Sort filenames to ensure consistent order
  const filenames = Object.keys(files).sort();

  for (const filename of filenames) {
    const parts = filename.split("/");
    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: currentPath,
          children: {},
          isFile
        };
      }
      current = current.children[part];
    }
  }

  return root;
}

const FileIcon = ({ filename }: { filename: string }) => {
  if (filename.endsWith('.tsx') || filename.endsWith('.jsx')) {
    return <FileCode className="h-4 w-4 text-blue-400" />;
  }
  if (filename.endsWith('.ts') || filename.endsWith('.js')) {
    return <FileType className="h-4 w-4 text-yellow-400" />;
  }
  if (filename.endsWith('.json')) {
    return <FileJson className="h-4 w-4 text-orange-400" />;
  }
  if (filename.endsWith('.css')) {
    return <FileCode className="h-4 w-4 text-sky-300" />;
  }
  if (filename.endsWith('.md')) {
    return <FileText className="h-4 w-4 text-gray-400" />;
  }
  return <File className="h-4 w-4 text-gray-500" />;
};

function TreeNodeItem({
  node,
  depth,
  activeFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (filename: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const children = useMemo(() => {
    return Object.values(node.children).sort((a, b) => {
      if (a.isFile === b.isFile) return a.name.localeCompare(b.name);
      return a.isFile ? 1 : -1;
    });
  }, [node.children]);

  if (node.isFile) {
    const isActive = activeFile === node.path;
    return (
      <button
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-slate-800/60",
          isActive
            ? "border-l-2 border-cyan-400 bg-cyan-400/10 text-cyan-200"
            : "border-l-2 border-transparent text-slate-400"
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <FileIcon filename={node.name} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-200"
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <div className="flex items-center gap-2">
          {expanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <span className="truncate font-medium">{node.name}</span>
        </div>
      </button>
      {expanded && children.map((child) => (
        <TreeNodeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          activeFile={activeFile}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}

export default function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  const children = useMemo(() => {
    return Object.values(tree.children).sort((a, b) => {
      if (a.isFile === b.isFile) return a.name.localeCompare(b.name);
      return a.isFile ? 1 : -1;
    });
  }, [tree]);

  return (
    <div className="flex h-full flex-col bg-transparent">
      {/* Header / Actions */}
      <div className="panel-header flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Explorer</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-slate-400 hover:text-slate-100"
          title="New File"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {children.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            onSelectFile={onSelectFile}
          />
        ))}

        {children.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            No files found
          </div>
        )}
      </div>
    </div>
  );
}
