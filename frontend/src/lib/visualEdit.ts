import type { FileData } from "@/store/builderStore";

export interface VisualElement {
  selector: string;
  tag: string;
  text: string;
  className: string;
  rect?: { x: number; y: number; width: number; height: number };
  styles?: {
    color?: string;
    backgroundColor?: string;
    padding?: string;
    fontSize?: string;
  };
}

export interface VisualElementChange {
  text?: string;
  className?: string;
  styles?: Record<string, string>;
}

export function parseElementInstruction(
  element: VisualElement,
  change: VisualElementChange,
  files: Record<string, FileData>
) {
  const candidateFile = findBestFileForElement(element, files);
  const updatedClasses = change.className || element.className;
  const updatedText = typeof change.text === "string" ? change.text : element.text;

  const prompt = [
    `In the file ${candidateFile}, change the element with text "${element.text}".`,
    `Use selector: ${element.selector}.`,
    `Update its Tailwind classes to: ${updatedClasses || "(keep existing classes)"}.`,
    `Set its text content to: "${updatedText}".`,
    "Return only the updated full file in FILE block format.",
  ].join(" ");

  return {
    targetFile: candidateFile,
    prompt,
    newClasses: updatedClasses,
    newText: updatedText,
  };
}

function findBestFileForElement(
  element: VisualElement,
  files: Record<string, FileData>
): string {
  const entries = Object.values(files);
  if (entries.length === 0) return "src/App.tsx";

  const text = (element.text || "").trim();
  const className = (element.className || "").trim();

  if (text) {
    const byText = entries.find((file) => file.content.includes(text));
    if (byText) return byText.filename;
  }

  if (className) {
    const byClass = entries.find((file) => file.content.includes(className));
    if (byClass) return byClass.filename;
  }

  const appFile = entries.find((file) => file.filename.endsWith("App.tsx"));
  if (appFile) return appFile.filename;

  return entries[0].filename;
}

export function applyQuickVisualEdit(
  originalContent: string,
  element: VisualElement,
  change: VisualElementChange
) {
  let next = originalContent;

  if (element.className && change.className) {
    next = next.replace(element.className, change.className);
  }

  if (element.text && typeof change.text === "string") {
    next = next.replace(element.text, change.text);
  }

  return next;
}
