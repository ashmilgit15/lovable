import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VisualElement, VisualElementChange } from "@/lib/visualEdit";

interface VisualEditOverlayProps {
  enabled: boolean;
  selectedElement: VisualElement | null;
  onApply: (change: VisualElementChange) => void;
  onAskAI: (change: VisualElementChange) => void;
  onClose: () => void;
}

type SizePreset = "S" | "M" | "L" | "XL";

const SIZE_CLASSES: Record<SizePreset, string> = {
  S: "px-2 py-1 text-xs",
  M: "px-3 py-2 text-sm",
  L: "px-4 py-3 text-base",
  XL: "px-6 py-4 text-lg",
};

export default function VisualEditOverlay({
  enabled,
  selectedElement,
  onApply,
  onAskAI,
  onClose,
}: VisualEditOverlayProps) {
  const [text, setText] = useState(selectedElement?.text || "");
  const [backgroundColor, setBackgroundColor] = useState("#1f2937");
  const [textColor, setTextColor] = useState("#ffffff");
  const [size, setSize] = useState<SizePreset>("M");

  const position = useMemo(() => {
    if (!selectedElement?.rect) return { top: 64, left: 24 };
    return {
      top: Math.max(64, selectedElement.rect.y + selectedElement.rect.height + 12),
      left: Math.max(16, selectedElement.rect.x),
    };
  }, [selectedElement]);

  if (!enabled || !selectedElement) {
    return null;
  }

  const mergedClassName = mergeClassName(
    selectedElement.className || "",
    SIZE_CLASSES[size],
    `bg-[${backgroundColor}]`,
    `text-[${textColor}]`
  );

  const change: VisualElementChange = {
    text,
    className: mergedClassName,
    styles: {
      backgroundColor,
      color: textColor,
    },
  };

  return (
    <div
      className="absolute z-40 w-[320px] rounded-xl border border-violet-500/30 bg-[#111111]/95 p-3 shadow-2xl shadow-violet-950/40 backdrop-blur"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
          Visual Edit
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-gray-400 hover:bg-[#1e1e1e] hover:text-white"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Text</p>
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-8 bg-[#161616] border-[#262626] text-xs text-gray-200"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-[10px] uppercase tracking-wider text-gray-500">
            Background
            <input
              type="color"
              value={backgroundColor}
              onChange={(event) => setBackgroundColor(event.target.value)}
              className="h-8 w-full cursor-pointer rounded border border-[#262626] bg-[#161616]"
            />
          </label>
          <label className="space-y-1 text-[10px] uppercase tracking-wider text-gray-500">
            Text
            <input
              type="color"
              value={textColor}
              onChange={(event) => setTextColor(event.target.value)}
              className="h-8 w-full cursor-pointer rounded border border-[#262626] bg-[#161616]"
            />
          </label>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Size</p>
          <div className="grid grid-cols-4 gap-1">
            {(["S", "M", "L", "XL"] as SizePreset[]).map((option) => (
              <Button
                key={option}
                size="sm"
                variant="ghost"
                className={`h-7 text-[10px] ${
                  option === size
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-gray-400 hover:bg-[#1e1e1e]"
                }`}
                onClick={() => setSize(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="h-8 flex-1 bg-violet-600 text-xs text-white hover:bg-violet-700"
            onClick={() => onApply(change)}
          >
            Apply
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 border-violet-500/40 bg-violet-500/10 text-xs text-violet-200 hover:bg-violet-500/20"
            onClick={() => onAskAI(change)}
          >
            Ask AI Redesign
          </Button>
        </div>
      </div>
    </div>
  );
}

function mergeClassName(base: string, ...patches: string[]) {
  const all = [base, ...patches]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);

  return Array.from(new Set(all)).join(" ");
}
