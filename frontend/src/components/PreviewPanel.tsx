import { useBuilderStore, type FileData } from "@/store/builderStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  Terminal as TerminalIcon,
  Zap,
  AlertCircle,
  Square,
  Play,
  MousePointer2,
} from "lucide-react";
import { SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import { useDevServerSocket } from "@/lib/useDevServerSocket";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Ansi from "ansi-to-html";
import VisualEditOverlay from "@/components/VisualEditOverlay";
import {
  applyQuickVisualEdit,
  parseElementInstruction,
  type VisualElement,
  type VisualElementChange,
} from "@/lib/visualEdit";
import { authHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/backend";

const converter = new Ansi({
  fg: "#e5e7eb",
  bg: "#0d0d0d",
  newline: true,
  escapeXML: true,
});

interface PreviewPanelProps {
  onSendVisualPrompt: (prompt: string) => void;
}

interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

function normalizeSandpackPath(filename: string): string {
  const normalized = filename.replace(/\\/g, "/").trim();
  if (!normalized) return "/";

  let pathOnly = normalized.split("#")[0] || normalized;
  pathOnly = pathOnly.split("?")[0] || pathOnly;

  // Convert absolute URLs to their pathname so local mirrored files can match.
  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      pathOnly = new URL(pathOnly).pathname || "/";
    } catch {
      // Keep the original value if URL parsing fails.
    }
  }

  const prefixed = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const compacted = prefixed.replace(/\/{2,}/g, "/");
  const segments: string[] = [];

  for (const segment of compacted.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

function dirname(path: string): string {
  const normalized = normalizeSandpackPath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

function resolveSandpackAssetPath(
  reference: string,
  fromFile = "/index.html"
): string | null {
  const trimmed = reference.trim();
  if (!trimmed) return null;
  if (/^(data:|blob:|javascript:|mailto:|tel:)/i.test(trimmed)) return null;
  if (/^\/\//.test(trimmed)) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return normalizeSandpackPath(new URL(trimmed).pathname);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("/")) {
    return normalizeSandpackPath(trimmed);
  }

  return normalizeSandpackPath(`${dirname(fromFile)}/${trimmed}`);
}

function findExistingSandpackPath(
  availableFiles: Record<string, string>,
  rawPath: string
): string | null {
  const normalized = normalizeSandpackPath(rawPath);
  const candidates = [normalized];

  if (normalized.startsWith("/public/")) {
    candidates.push(normalized.replace(/^\/public/, "") || "/");
  } else if (normalized.startsWith("/")) {
    candidates.push(`/public${normalized}`);
  }

  if (normalized.startsWith("/dist/")) {
    candidates.push(normalized.replace(/^\/dist/, "") || "/");
  }
  if (normalized.startsWith("/build/")) {
    candidates.push(normalized.replace(/^\/build/, "") || "/");
  }
  if (normalized.startsWith("/out/")) {
    candidates.push(normalized.replace(/^\/out/, "") || "/");
  }

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(availableFiles, candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseSandpackDeps(
  rawPackageJson: string | undefined
): Record<string, string> {
  if (!rawPackageJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawPackageJson) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const runtimeDependencies: Record<string, string> = {};
    const sourceDependencies = parsed.dependencies || {};
    const declaredDevDependencies = parsed.devDependencies || {};
    const blockedPackages = [
      /^vite$/i,
      /^esbuild$/i,
      /^@vitejs\//i,
      /^typescript$/i,
      /^eslint/i,
    ];

    for (const [name, value] of Object.entries(sourceDependencies)) {
      if (typeof value !== "string") continue;
      if (blockedPackages.some((pattern) => pattern.test(name))) continue;
      runtimeDependencies[name] = value;
    }

    const hasVite =
      typeof sourceDependencies.vite === "string" ||
      typeof declaredDevDependencies.vite === "string" ||
      Object.keys(sourceDependencies).some((name) => /^@vitejs\//i.test(name)) ||
      Object.keys(declaredDevDependencies).some((name) => /^@vitejs\//i.test(name));
    if (hasVite && !runtimeDependencies["esbuild-wasm"]) {
      runtimeDependencies["esbuild-wasm"] = "^0.25.0";
    }

    return runtimeDependencies;
  } catch {
    return {};
  }
}

function parsePackageJson(
  rawPackageJson: string | undefined
): Record<string, unknown> | null {
  if (!rawPackageJson) return null;
  try {
    const parsed = JSON.parse(rawPackageJson);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toStringDeps(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version === "string" && version.trim()) {
      out[name] = version;
    }
  }
  return out;
}

function pickFallbackCssFile(availableFiles: Record<string, string>): string | null {
  const preferred = [
    "/src/index.css",
    "/src/App.css",
    "/index.css",
    "/styles.css",
  ];
  for (const candidate of preferred) {
    if (Object.prototype.hasOwnProperty.call(availableFiles, candidate)) {
      return candidate;
    }
  }

  const firstCss = Object.keys(availableFiles).find(
    (path) => path.endsWith(".css") && !path.includes("/node_modules/")
  );
  return firstCss || null;
}

function hasFile(availableFiles: Record<string, string>, path: string): boolean {
  return Boolean(findExistingSandpackPath(availableFiles, path));
}

function extractAssetRefs(indexHtml: string): { js: string[]; css: string[] } {
  const js: string[] = [];
  const css: string[] = [];
  indexHtml.replace(
    /<script[^>]+src=["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi,
    (_match, src: string) => {
      js.push(src);
      return _match;
    }
  );
  indexHtml.replace(
    /<link[^>]+href=["']([^"']+\.css)["'][^>]*>\s*/gi,
    (_match, href: string) => {
      css.push(href);
      return _match;
    }
  );
  return { js, css };
}

function extractScriptRefs(indexHtml: string): string[] {
  const scripts: string[] = [];
  indexHtml.replace(
    /<script[^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (_match, src: string) => {
      scripts.push(src);
      return _match;
    }
  );
  return scripts;
}

function hasCompleteBuiltAssetBundle(
  indexHtml: string,
  availableFiles: Record<string, string>,
  htmlPath: string
): boolean {
  const scriptRefs = extractScriptRefs(indexHtml);
  const hasSourceEntrypointScript = scriptRefs.some((src) => {
    const resolved = resolveSandpackAssetPath(src, htmlPath);
    const target = (resolved || src || "").toLowerCase();
    return (
      target.startsWith("/src/") ||
      /\/src\//.test(target) ||
      /\.(?:ts|tsx|jsx)(?:$|\?)/.test(target)
    );
  });
  if (hasSourceEntrypointScript) return false;

  const refs = extractAssetRefs(indexHtml);
  if (refs.js.length === 0) return false;
  const hasNonBridgeJs = refs.js.some(
    (src) => !/forge-bridge\.js(?:$|\?)/i.test(src)
  );
  if (!hasNonBridgeJs) return false;

  const hasLocalOrExternalAsset = (reference: string) => {
    const resolved = resolveSandpackAssetPath(reference, htmlPath);
    if (!resolved) return true;
    return hasFile(availableFiles, resolved);
  };

  const jsPresent = refs.js.every(hasLocalOrExternalAsset);
  const cssPresent = refs.css.every(hasLocalOrExternalAsset);
  return jsPresent && cssPresent;
}

function escapeInlineScript(content: string): string {
  return content.replace(/<\/script/gi, "<\\/script");
}

function escapeInlineStyle(content: string): string {
  return content.replace(/<\/style/gi, "<\\/style");
}

function inlineBuiltAssets(
  indexHtml: string,
  availableFiles: Record<string, string>,
  htmlPath: string
): string {
  let normalized = indexHtml;

  normalized = normalized.replace(
    /<link[^>]+href=["']([^"']+\.css)["'][^>]*>\s*/gi,
    (fullMatch, href: string) => {
      const resolved = resolveSandpackAssetPath(href, htmlPath);
      if (!resolved) return fullMatch;
      const existingPath = findExistingSandpackPath(availableFiles, resolved);
      if (!existingPath) return fullMatch;
      const cssContent = availableFiles[existingPath];
      if (typeof cssContent !== "string") return fullMatch;
      return `<style data-inline-href="${existingPath}">\n${escapeInlineStyle(cssContent)}\n</style>\n`;
    }
  );

  normalized = normalized.replace(
    /<script([^>]*)src=["']([^"']+\.js)["']([^>]*)>\s*<\/script>/gi,
    (fullMatch, attrsBeforeSrc: string, src: string, attrsAfterSrc: string) => {
      const resolved = resolveSandpackAssetPath(src, htmlPath);
      if (!resolved) return fullMatch;
      const existingPath = findExistingSandpackPath(availableFiles, resolved);
      if (!existingPath) return fullMatch;
      const jsContent = availableFiles[existingPath];
      if (typeof jsContent !== "string") return fullMatch;

      const fullAttrs = `${attrsBeforeSrc} ${attrsAfterSrc}`;
      const isModule = /type=["']module["']/i.test(fullAttrs);
      const typeAttr = isModule ? ' type="module"' : "";
      return `<script${typeAttr} data-inline-src="${existingPath}">\n${escapeInlineScript(jsContent)}\n</script>\n`;
    }
  );

  return normalized;
}

function createDefaultRuntimeIndexHtml(entry: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${entry}"></script>
</body>
</html>`;
}

function collectUsedPackages(sandpackFiles: Record<string, string>): Set<string> {
  const used = new Set<string>();
  const sourceFilePattern = /\.(?:[cm]?[jt]sx?)$/i;
  const importPattern =
    /\b(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  for (const [path, content] of Object.entries(sandpackFiles)) {
    if (!sourceFilePattern.test(path)) continue;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(content)) !== null) {
      const specifier = (match[1] || match[2] || "").trim();
      if (
        !specifier ||
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("@/") ||
        specifier.startsWith("~/")
      ) {
        continue;
      }
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (packageName) used.add(packageName);
    }
  }

  return used;
}

function hardenCommonListMaps(content: string): string {
  const listIdentifiers = [
    "logos",
    "plans",
    "pricingPlans",
    "features",
    "testimonials",
    "services",
  ];

  let next = content;
  for (const identifier of listIdentifiers) {
    const mapPattern = new RegExp(`\\b${identifier}\\.map\\(`, "g");
    next = next.replace(
      mapPattern,
      `(Array.isArray(${identifier}) ? ${identifier} : []).map(`
    );
  }

  return next;
}

function parseRelativeUiNamedImports(clause: string): Set<string> {
  const names = new Set<string>();
  const namedMatch = clause.match(/\{([\s\S]*?)\}/);
  if (!namedMatch) return names;

  const rawEntries = namedMatch[1].split(",");
  for (const rawEntry of rawEntries) {
    const candidate = rawEntry.trim();
    if (!candidate) continue;
    const originalName = candidate.split(/\s+as\s+/i)[0]?.trim();
    if (!originalName) continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(originalName)) continue;
    names.add(originalName);
  }

  return names;
}

function fallbackTagForUiExport(name: string): string {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("button") ||
    normalized.endsWith("trigger") ||
    normalized === "submit"
  ) {
    return "button";
  }
  if (
    normalized.includes("input") ||
    normalized.includes("checkbox") ||
    normalized.includes("radio") ||
    normalized.includes("switch")
  ) {
    return "input";
  }
  if (normalized.includes("textarea")) return "textarea";
  if (normalized.includes("label")) return "label";
  if (normalized.includes("form")) return "form";
  if (normalized.includes("link")) return "a";
  if (normalized.includes("image") || normalized.includes("img")) return "img";
  if (normalized.includes("separator") || normalized.includes("divider")) return "hr";
  if (normalized.includes("table")) return "table";
  if (normalized.includes("thead")) return "thead";
  if (normalized.includes("tbody")) return "tbody";
  if (normalized.includes("tr")) return "tr";
  if (normalized.includes("th")) return "th";
  if (normalized.includes("td")) return "td";
  if (normalized.includes("list")) return "ul";
  if (normalized.includes("item")) return "li";
  return "div";
}

function hasResolvableModule(
  sandpackFiles: Record<string, string>,
  moduleBasePath: string
): boolean {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
  const candidates: string[] = [moduleBasePath];

  for (const ext of extensions) {
    candidates.push(`${moduleBasePath}${ext}`);
  }

  if (!moduleBasePath.endsWith("/index")) {
    for (const ext of extensions) {
      candidates.push(`${moduleBasePath}/index${ext}`);
    }
  }

  return candidates.some((candidate) => Boolean(findExistingSandpackPath(sandpackFiles, candidate)));
}

function pickRelativeUiCompatPath(
  sandpackFiles: Record<string, string>,
  moduleBasePath: string,
  hasTypescript: boolean
): string {
  const extension = hasTypescript ? "tsx" : "jsx";
  if (moduleBasePath.endsWith("/index")) {
    return `${moduleBasePath}.${extension}`;
  }

  const folderPrefix = `${moduleBasePath}/`;
  const hasNestedUiFiles = Object.keys(sandpackFiles).some((path) =>
    path.startsWith(folderPrefix)
  );
  if (hasNestedUiFiles) {
    return `${moduleBasePath}/index.${extension}`;
  }

  return `${moduleBasePath}.${extension}`;
}

function buildRelativeUiCompatModuleContent(
  exportNames: string[],
  hasTypescript: boolean
): string {
  const uniqueExportNames = Array.from(
    new Set(exportNames.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)))
  ).sort();

  const needsCn = uniqueExportNames.includes("cn");
  const componentNames = uniqueExportNames.filter(
    (name) => name !== "cn" && !name.startsWith("use")
  );
  const hookNames = uniqueExportNames.filter(
    (name) => name !== "cn" && name.startsWith("use")
  );

  const componentDeclarations = componentNames
    .map((name) => {
      const tag = fallbackTagForUiExport(name);
      return `const ${name} = createFallback("${tag}");
${name}.displayName = "${name}";`;
    })
    .join("\n\n");

  const hookDeclarations = hookNames
    .map((name) => `const ${name} = () => ({});`)
    .join("\n");

  const namedExports = new Set<string>();
  if (needsCn) namedExports.add("cn");
  for (const name of componentNames) namedExports.add(name);
  for (const name of hookNames) namedExports.add(name);
  if (namedExports.size === 0) {
    namedExports.add("cn");
  }

  const orderedNamedExports = Array.from(namedExports).sort();
  const defaultObjectEntries = Array.from(namedExports).sort();

  if (hasTypescript) {
    return `import * as React from "react";

type FallbackProps = {
  className?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
};

const cn = (...values: Array<string | null | undefined | false>) =>
  values.filter(Boolean).join(" ");

const createFallback = (tag = "div") =>
  React.forwardRef<HTMLElement, FallbackProps>(function UiFallback(
    { className, children, ...props },
    ref
  ) {
    return React.createElement(
      tag,
      { ...props, ref, className: cn(className) },
      children
    );
  });

${componentDeclarations || ""}
${hookDeclarations || ""}

export { ${orderedNamedExports.join(", ")} };

const ui = { ${defaultObjectEntries.join(", ")} };
export default ui;
`;
  }

  return `import * as React from "react";

const cn = (...values) => values.filter(Boolean).join(" ");

const createFallback = (tag = "div") =>
  React.forwardRef(function UiFallback(
    { className, children, ...props },
    ref
  ) {
    return React.createElement(
      tag,
      { ...props, ref, className: cn(className) },
      children
    );
  });

${componentDeclarations || ""}
${hookDeclarations || ""}

export { ${orderedNamedExports.join(", ")} };

const ui = { ${defaultObjectEntries.join(", ")} };
export default ui;
`;
}

function ensureRelativeUiCompatModules(
  sandpackFiles: Record<string, string>,
  hasTypescript: boolean
) {
  const sourceFilePattern = /\.(?:[cm]?[jt]sx?)$/i;
  const uiImportPattern =
    /\bimport\s+([^;]+?)\s+from\s+["'](\.{1,2}\/ui(?:\/index)?)["'];?/g;
  const pendingCompatModules = new Map<string, Set<string>>();

  for (const [path, content] of Object.entries(sandpackFiles)) {
    if (!sourceFilePattern.test(path)) continue;
    if (typeof content !== "string") continue;

    let match: RegExpExecArray | null;
    while ((match = uiImportPattern.exec(content)) !== null) {
      const clause = (match[1] || "").trim();
      const specifier = (match[2] || "").trim();
      if (!clause || !specifier) continue;

      const moduleBasePath = normalizeSandpackPath(`${dirname(path)}/${specifier}`);
      if (hasResolvableModule(sandpackFiles, moduleBasePath)) {
        continue;
      }

      const compatPath = pickRelativeUiCompatPath(
        sandpackFiles,
        moduleBasePath,
        hasTypescript
      );
      const requestedNames = parseRelativeUiNamedImports(clause);
      const existing = pendingCompatModules.get(compatPath) || new Set<string>();
      for (const name of requestedNames) {
        existing.add(name);
      }
      pendingCompatModules.set(compatPath, existing);
    }
  }

  for (const [compatPath, exportNameSet] of pendingCompatModules.entries()) {
    if (sandpackFiles[compatPath]) continue;
    sandpackFiles[compatPath] = buildRelativeUiCompatModuleContent(
      Array.from(exportNameSet),
      hasTypescript
    );
  }
}

function extractColorVariableNames(cssContent: string): string[] {
  const colorVariables = new Set<string>();
  const variablePattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;

  while ((match = variablePattern.exec(cssContent)) !== null) {
    const name = (match[1] || "").trim();
    const value = (match[2] || "").trim().toLowerCase();
    if (!name || !value) continue;
    if (name.includes("radius")) continue;
    if (name.includes("font")) continue;

    const looksLikeColor =
      value.includes("%") ||
      value.includes("hsl(") ||
      value.includes("oklch(") ||
      value.includes("rgb(") ||
      value.includes("#");

    if (looksLikeColor) {
      colorVariables.add(name);
    }
  }

  return Array.from(colorVariables);
}

function buildColorUtilityFallbackCss(variableNames: string[]): string {
  if (variableNames.length === 0) return "";

  const lines: string[] = [];
  for (const variableName of variableNames) {
    lines.push(
      `.bg-${variableName}{background-color:hsl(var(--${variableName})) !important;}`,
      `.text-${variableName}{color:hsl(var(--${variableName})) !important;}`,
      `.border-${variableName}{border-color:hsl(var(--${variableName})) !important;}`,
      `.ring-${variableName}{--tw-ring-color:hsl(var(--${variableName})) !important;}`,
      `.fill-${variableName}{fill:hsl(var(--${variableName})) !important;}`,
      `.stroke-${variableName}{stroke:hsl(var(--${variableName})) !important;}`
    );
  }

  if (variableNames.includes("background") || variableNames.includes("foreground")) {
    const bodyFallback: string[] = [];
    if (variableNames.includes("background")) {
      bodyFallback.push("background-color:hsl(var(--background)) !important;");
    }
    if (variableNames.includes("foreground")) {
      bodyFallback.push("color:hsl(var(--foreground)) !important;");
    }
    if (bodyFallback.length > 0) {
      lines.push(`body{${bodyFallback.join("")}}`);
    }
  }

  if (variableNames.includes("border")) {
    lines.push(`*{border-color:hsl(var(--border));}`);
  }

  return lines.join("\n");
}

function toRelativeImportPath(fromFile: string, toFile: string): string {
  const fromSegments = normalizeSandpackPath(fromFile).split("/").filter(Boolean);
  const toSegments = normalizeSandpackPath(toFile).split("/").filter(Boolean);
  const fromDir = fromSegments.slice(0, -1);
  let shared = 0;

  while (
    shared < fromDir.length &&
    shared < toSegments.length &&
    fromDir[shared] === toSegments[shared]
  ) {
    shared += 1;
  }

  const upLevels = fromDir.length - shared;
  const downSegments = toSegments.slice(shared);
  const relative = [
    ...Array(upLevels).fill(".."),
    ...downSegments,
  ];

  return relative.length > 0 ? `./${relative.join("/")}`.replace(/^\.\/\.\.\//, "../") : "./";
}

function injectTwindRuntimeBootstrap(
  sandpackFiles: Record<string, string>,
  entry: string,
  colorVariableNames: string[]
) {
  const entryContent = sandpackFiles[entry];
  if (typeof entryContent !== "string" || !entryContent.trim()) return;

  const runtimePath = entry.endsWith(".ts") || entry.endsWith(".tsx")
    ? "/__sandbox_twind_runtime.ts"
    : "/__sandbox_twind_runtime.js";

  const colorEntries = colorVariableNames
    .map((name) => `        "${name}": "hsl(var(--${name}))"`)
    .join(",\n");

  const runtimeConfig = colorEntries
    ? `{
  theme: {
    extend: {
      colors: {
${colorEntries}
      },
    },
  },
}`
    : "{}";

  sandpackFiles[runtimePath] = `import { setup } from "twind";
import { observe } from "twind/observe";

setup(${runtimeConfig});
observe(document.documentElement);
`;

  if (entryContent.includes("__sandbox_twind_runtime")) return;

  const importPath = toRelativeImportPath(entry, runtimePath);
  sandpackFiles[entry] = `import "${importPath}";
${entryContent}`;
}

function findExistingConfigPath(
  sandpackFiles: Record<string, string>,
  candidates: string[]
): string | null {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(sandpackFiles, candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeNativeTailwindConfigForSandpack(
  sandpackFiles: Record<string, string>
) {
  const postcssPath = findExistingConfigPath(sandpackFiles, [
    "/postcss.config.cjs",
    "/postcss.config.js",
    "/postcss.config.mjs",
  ]);
  if (postcssPath && typeof sandpackFiles[postcssPath] === "string") {
    const postcssContent = sandpackFiles[postcssPath];
    const canUseCjsSyntax = postcssPath.endsWith(".cjs") || postcssPath.endsWith(".js");
    if (
      canUseCjsSyntax &&
      /export\s+default/.test(postcssContent) &&
      !/module\.exports\s*=/.test(postcssContent)
    ) {
      sandpackFiles[postcssPath] = postcssContent.replace(
        /export\s+default/,
        "module.exports ="
      );
    }
  }

  const tailwindPath = findExistingConfigPath(sandpackFiles, [
    "/tailwind.config.cjs",
    "/tailwind.config.js",
    "/tailwind.config.mjs",
  ]);
  if (tailwindPath && typeof sandpackFiles[tailwindPath] === "string") {
    let tailwindContent = sandpackFiles[tailwindPath];
    const canUseCjsSyntax = tailwindPath.endsWith(".cjs") || tailwindPath.endsWith(".js");
    if (
      canUseCjsSyntax &&
      /export\s+default/.test(tailwindContent) &&
      !/module\.exports\s*=/.test(tailwindContent)
    ) {
      tailwindContent = tailwindContent.replace(
        /export\s+default/,
        "module.exports ="
      );
    }

    tailwindContent = tailwindContent.replace(
      /content:\s*\[([\s\S]*?)\]/m,
      (fullMatch, inner: string) => {
        if (inner.includes("./index.html")) return fullMatch;
        const trimmed = inner.trim();
        if (!trimmed) {
          return `content: [\n    "./index.html"\n  ]`;
        }
        return `content: [\n    "./index.html",\n${trimmed}\n  ]`;
      }
    );

    sandpackFiles[tailwindPath] = tailwindContent;
  }
}

function buildRuntimeCssSupport(
  sandpackFiles: Record<string, string>
): {
  cssPath: string | null;
  includeTailwindCdn: boolean;
  inlineTailwindCss: string | null;
  sourceCssPath: string | null;
  usesTailwindBuildDirectives: boolean;
  tailwindRuntime: "v3" | "v4" | null;
  colorVariableNames: string[];
  nativeTailwindBuild: boolean;
} {
  const cssPath = pickFallbackCssFile(sandpackFiles);
  if (!cssPath) {
    return {
      cssPath: null,
      includeTailwindCdn: false,
      inlineTailwindCss: null,
      sourceCssPath: null,
      usesTailwindBuildDirectives: false,
      tailwindRuntime: null,
      colorVariableNames: [],
      nativeTailwindBuild: false,
    };
  }
  const cssContent = sandpackFiles[cssPath] || "";
  const usesTailwindBuildDirectives =
    /@tailwind\s+(?:base|components|utilities)\s*;/i.test(cssContent) ||
    /@import\s+["']tailwindcss["'];?/i.test(cssContent) ||
    /@apply\s+[^;]+;/i.test(cssContent) ||
    /@theme\s*\{/i.test(cssContent) ||
    /@custom-variant\s+/i.test(cssContent);

  const usesTailwindV4Directives =
    /@import\s+["']tailwindcss["'];?/i.test(cssContent) ||
    /@theme\s*\{/i.test(cssContent) ||
    /@custom-variant\s+/i.test(cssContent);
  const hasPostcssConfig = Boolean(
    findExistingConfigPath(sandpackFiles, [
      "/postcss.config.js",
      "/postcss.config.cjs",
      "/postcss.config.mjs",
    ])
  );
  const hasTailwindConfig = Boolean(
    findExistingConfigPath(sandpackFiles, [
      "/tailwind.config.js",
      "/tailwind.config.cjs",
      "/tailwind.config.mjs",
      "/tailwind.config.ts",
    ])
  );
  const nativeTailwindBuild = usesTailwindBuildDirectives && hasPostcssConfig && hasTailwindConfig;

  if (!usesTailwindBuildDirectives) {
    return {
      cssPath,
      includeTailwindCdn: false,
      inlineTailwindCss: null,
      sourceCssPath: cssPath,
      usesTailwindBuildDirectives: false,
      tailwindRuntime: null,
      colorVariableNames: [],
      nativeTailwindBuild: false,
    };
  }

  if (nativeTailwindBuild) {
    return {
      cssPath,
      includeTailwindCdn: false,
      inlineTailwindCss: null,
      sourceCssPath: cssPath,
      usesTailwindBuildDirectives: true,
      tailwindRuntime: usesTailwindV4Directives ? "v4" : "v3",
      colorVariableNames: [],
      nativeTailwindBuild: true,
    };
  }

  // Tailwind runtime input (browser compiler).
  // Normalize v4 @import syntax to explicit directives for broad runtime compatibility.
  let browserTailwindCss = cssContent
    .replace(
      /@import\s+["']tailwindcss["'];?\s*/gi,
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n"
    );
  if (!/@tailwind\s+(?:base|components|utilities)\s*;/i.test(browserTailwindCss)) {
    browserTailwindCss = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${browserTailwindCss}`;
  }
  // Browser runtime does not have full project Tailwind config context.
  // Unknown custom token utilities inside @apply can abort all Tailwind output.
  browserTailwindCss = browserTailwindCss.replace(/@apply\s+[^;]+;\s*/gi, "");

  // Plain CSS fallback keeps non-tailwind declarations (keyframes, custom rules)
  // while stripping directives that require a build step.
  const colorVariableNames = extractColorVariableNames(cssContent);
  const colorUtilityFallbackCss = buildColorUtilityFallbackCss(colorVariableNames);
  const plainCssFallback = cssContent
    .replace(/@import\s+["']tailwindcss["'];?\s*/gi, "")
    .replace(/@tailwind\s+(?:base|components|utilities)\s*;\s*/gi, "")
    .replace(/@custom-variant\s+[^\n]*\n?/gi, "")
    .replace(/@theme\s*\{[\s\S]*?\}\s*/gi, "")
    .replace(/@apply\s+[^;]+;/gi, "");

  const generatedPath = "/__sandbox_preview.css";
  sandpackFiles[generatedPath] = `${plainCssFallback}\n\n${colorUtilityFallbackCss}`.trim();
  return {
    cssPath: generatedPath,
    includeTailwindCdn: false,
    inlineTailwindCss: null,
    sourceCssPath: cssPath,
    usesTailwindBuildDirectives: true,
    tailwindRuntime: usesTailwindV4Directives ? "v4" : "v3",
    colorVariableNames,
    nativeTailwindBuild: false,
  };
}

function normalizeIndexHtmlForRuntime(
  indexHtml: string,
  entry: string,
  availableFiles: Record<string, string>,
  cssPath: string | null,
  includeTailwindCdn: boolean,
  inlineTailwindCss: string | null,
  tailwindRuntime: "v3" | "v4" | null,
  sourceHtmlPath = "/index.html"
): string {
  let normalized = indexHtml || createDefaultRuntimeIndexHtml(entry);

  if (!/<div[^>]+id=["']root["'][^>]*>/i.test(normalized)) {
    normalized = normalized.replace(
      /<body[^>]*>/i,
      `$&\n  <div id="root"></div>`
    );
  }

  const hasResolvedFile = (resolvedPath: string | null) => {
    if (!resolvedPath) return false;
    return Boolean(findExistingSandpackPath(availableFiles, resolvedPath));
  };

  normalized = normalized.replace(
    /<link[^>]+href=["']([^"']+\.css)["'][^>]*>\s*/gi,
    (fullMatch, existingCssHref: string) => {
      const resolvedCssHref = resolveSandpackAssetPath(
        existingCssHref,
        sourceHtmlPath
      );
      if (hasResolvedFile(resolvedCssHref)) {
        const existingPath = findExistingSandpackPath(
          availableFiles,
          resolvedCssHref || ""
        );
        return resolvedCssHref
          ? fullMatch.replace(existingCssHref, existingPath || resolvedCssHref)
          : fullMatch;
      }
      if (!resolvedCssHref) {
        // Keep external stylesheets untouched.
        return fullMatch;
      }
      if (cssPath) {
        return fullMatch.replace(existingCssHref, cssPath);
      }
      return "";
    }
  );

  if (inlineTailwindCss) {
    const tailwindStyleTag = `<style type="text/tailwindcss" data-inline-tailwind="true">\n${escapeInlineStyle(inlineTailwindCss)}\n</style>`;
    if (!/data-inline-tailwind=["']true["']/i.test(normalized)) {
      if (/<\/head>/i.test(normalized)) {
        normalized = normalized.replace(/<\/head>/i, `  ${tailwindStyleTag}\n</head>`);
      } else {
        normalized = `<head>\n  ${tailwindStyleTag}\n</head>\n${normalized}`;
      }
    }
  }

  if (
    cssPath &&
    !new RegExp(`href=["']${cssPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(normalized)
  ) {
    if (/<\/head>/i.test(normalized)) {
      normalized = normalized.replace(
        /<\/head>/i,
        `  <link rel="stylesheet" href="${cssPath}" />\n</head>`
      );
    } else {
      normalized = `<head>\n  <link rel="stylesheet" href="${cssPath}" />\n</head>\n${normalized}`;
    }
  }

  if (
    includeTailwindCdn &&
    !/tailwind\.min\.css|data-inline-tailwind-loader/i.test(normalized)
  ) {
    // Sandpack can strip external scripts from project HTML. Prefer a static stylesheet fallback.
    const tailwindStylesheet =
      '<link rel="stylesheet" data-inline-tailwind-loader="true" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" />';
    if (/<\/head>/i.test(normalized)) {
      normalized = normalized.replace(
        /<\/head>/i,
        `  ${tailwindStylesheet}\n</head>`
      );
    } else {
      normalized = `<head>\n  ${tailwindStylesheet}\n</head>\n${normalized}`;
    }
  }

  const scriptPattern =
    /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/i;
  if (scriptPattern.test(normalized)) {
    normalized = normalized.replace(
      scriptPattern,
      (fullMatch, scriptPath: string) => {
        const resolvedScriptPath = resolveSandpackAssetPath(
          scriptPath,
          sourceHtmlPath
        );
        if (hasResolvedFile(resolvedScriptPath)) {
          const existingPath = findExistingSandpackPath(
            availableFiles,
            resolvedScriptPath || ""
          );
          return resolvedScriptPath
            ? fullMatch.replace(scriptPath, existingPath || resolvedScriptPath)
            : fullMatch;
        }
        if (!resolvedScriptPath) {
          // Keep external scripts untouched.
          return fullMatch;
        }
        return `<script type="module" src="${entry}"></script>`;
      }
    );
  } else if (/<\/body>/i.test(normalized)) {
    normalized = normalized.replace(
      /<\/body>/i,
      `  <script type="module" src="${entry}"></script>\n</body>`
    );
  } else {
    normalized += `\n<script type="module" src="${entry}"></script>`;
  }

  return normalized;
}

function rewriteEntryCssImportForRuntime(
  sandpackFiles: Record<string, string>,
  entry: string,
  sourceCssPath: string | null,
  runtimeCssPath: string | null
) {
  if (!sourceCssPath || !runtimeCssPath || sourceCssPath === runtimeCssPath) return;

  const entryContent = sandpackFiles[entry];
  if (typeof entryContent !== "string" || !entryContent) return;

  const importPattern = /(^|\n)\s*import\s+["']([^"']+\.css(?:\?[^"']*)?)["'];?/g;
  let changed = false;
  const nextContent = entryContent.replace(
    importPattern,
    (fullMatch, prefix: string, specifier: string) => {
      const resolved = resolveSandpackAssetPath(specifier, entry);
      if (!resolved) return fullMatch;
      const existingPath = findExistingSandpackPath(sandpackFiles, resolved) || resolved;
      if (existingPath !== sourceCssPath) return fullMatch;
      changed = true;
      return `${prefix}import "${runtimeCssPath}";`;
    }
  );

  if (changed) {
    sandpackFiles[entry] = nextContent;
  }
}

function ensureRuntimePackageJson(
  sandpackFiles: Record<string, string>,
  entry: string,
  hasTypescript: boolean,
  usedPackages: Set<string>,
  extraDependencies: string[] = []
): Record<string, string> {
  const rawPackageJson = sandpackFiles["/package.json"];
  const parsed = parsePackageJson(rawPackageJson);

  const blockedPackages = [
    /^vite$/i,
    /^esbuild/i,
    /^@vitejs\//i,
    /^typescript$/i,
    /^eslint/i,
  ];

  if (!parsed) {
    const dependencies: Record<string, string> = {};
    const discovered = parseSandpackDeps(rawPackageJson);
    for (const pkg of usedPackages) {
      dependencies[pkg] = discovered[pkg] || "latest";
    }
    for (const pkg of extraDependencies) {
      if (blockedPackages.some((pattern) => pattern.test(pkg))) continue;
      if (!dependencies[pkg]) {
        dependencies[pkg] = discovered[pkg] || "latest";
      }
    }
    if (!dependencies.react) dependencies.react = "^19.0.0";
    if (!dependencies["react-dom"]) dependencies["react-dom"] = "^19.0.0";

    sandpackFiles["/package.json"] = JSON.stringify(
      {
        name: "sandpack-project",
        main: entry,
        dependencies,
      },
      null,
      2
    );
    return dependencies;
  }

  const runtimeDependencies: Record<string, string> = {};
  const allDependencies = {
    ...toStringDeps(parsed.dependencies),
    ...toStringDeps(parsed.devDependencies),
  };

  for (const [name, version] of Object.entries(allDependencies)) {
    if (!usedPackages.has(name) && !/^react(-dom)?$/i.test(name)) continue;
    if (blockedPackages.some((pattern) => pattern.test(name))) continue;
    runtimeDependencies[name] = version;
  }

  for (const pkg of usedPackages) {
    if (blockedPackages.some((pattern) => pattern.test(pkg))) continue;
    if (!runtimeDependencies[pkg]) {
      runtimeDependencies[pkg] = allDependencies[pkg] || "latest";
    }
  }
  for (const pkg of extraDependencies) {
    if (blockedPackages.some((pattern) => pattern.test(pkg))) continue;
    if (!runtimeDependencies[pkg]) {
      runtimeDependencies[pkg] = allDependencies[pkg] || "latest";
    }
  }

  if (!runtimeDependencies.react) runtimeDependencies.react = "^19.0.0";
  if (!runtimeDependencies["react-dom"]) runtimeDependencies["react-dom"] = "^19.0.0";

  if (hasTypescript) {
    if (!runtimeDependencies.typescript) runtimeDependencies.typescript = "^5.9.0";
    if (!runtimeDependencies["@types/react"]) runtimeDependencies["@types/react"] = "^19.0.0";
    if (!runtimeDependencies["@types/react-dom"]) runtimeDependencies["@types/react-dom"] = "^19.0.0";
  }

  const normalized: Record<string, unknown> = {
    ...parsed,
    main: entry,
    dependencies: runtimeDependencies,
  };
  delete normalized.devDependencies;
  delete normalized.type;

  sandpackFiles["/package.json"] = JSON.stringify(normalized, null, 2);
  return runtimeDependencies;
}

function buildSandpackProject(files: Record<string, FileData>) {
  const sandpackFiles: Record<string, string> = {};

  for (const file of Object.values(files)) {
    if (!file?.filename) continue;
    const path = normalizeSandpackPath(file.filename);

    const sourceContent = file.content ?? "";
    const content = /\.(?:[jt]sx)$/i.test(path)
      ? hardenCommonListMaps(sourceContent)
      : sourceContent;
    sandpackFiles[path] = content;

    // Mirror /public assets to root to match typical references like /forge-bridge.js
    if (path.startsWith("/public/")) {
      const publicResolvedPath = path.replace(/^\/public/, "") || "/";
      if (!sandpackFiles[publicResolvedPath]) {
        sandpackFiles[publicResolvedPath] = content;
      }
    }
  }

  const entryCandidates = [
    "/src/main.tsx",
    "/src/main.jsx",
    "/src/index.tsx",
    "/src/index.jsx",
    "/main.tsx",
    "/main.jsx",
    "/index.tsx",
    "/index.jsx",
  ];
  const entry = entryCandidates.find((candidate) => sandpackFiles[candidate]);
  const hasTypescript = Object.keys(sandpackFiles).some(
    (path) => path.endsWith(".ts") || path.endsWith(".tsx")
  );
  ensureRelativeUiCompatModules(sandpackFiles, hasTypescript);
  const defaultEntry = hasTypescript ? "/src/main.tsx" : "/src/main.jsx";
  const effectiveEntry = entry || defaultEntry;

  const htmlEntryCandidates = [
    "/index.html",
    "/dist/index.html",
    "/build/index.html",
    "/out/index.html",
  ];
  const htmlEntry =
    htmlEntryCandidates.find((candidate) => sandpackFiles[candidate]) || "/index.html";
  const indexHtml = sandpackFiles[htmlEntry] || "";
  const hasBuiltBundle = Boolean(indexHtml) &&
    hasCompleteBuiltAssetBundle(indexHtml, sandpackFiles, htmlEntry);

  if (hasBuiltBundle) {
    const staticIndexHtml = inlineBuiltAssets(indexHtml, sandpackFiles, htmlEntry);
    sandpackFiles[htmlEntry] = staticIndexHtml;
    sandpackFiles["/index.html"] = staticIndexHtml;
    return {
      files: sandpackFiles,
      dependencies: {},
      entry: "/index.html",
      environment: "static" as const,
      activeFile: "/index.html",
      fileCount: Object.keys(sandpackFiles).length,
      template: "static" as const,
    };
  }

  const cssSupport = buildRuntimeCssSupport(sandpackFiles);
  if (cssSupport.nativeTailwindBuild) {
    normalizeNativeTailwindConfigForSandpack(sandpackFiles);
  } else {
    rewriteEntryCssImportForRuntime(
      sandpackFiles,
      effectiveEntry,
      cssSupport.sourceCssPath,
      cssSupport.cssPath
    );
  }
  if (cssSupport.usesTailwindBuildDirectives && !cssSupport.nativeTailwindBuild) {
    injectTwindRuntimeBootstrap(
      sandpackFiles,
      effectiveEntry,
      cssSupport.colorVariableNames
    );
  }
  const dependencies = ensureRuntimePackageJson(
    sandpackFiles,
    effectiveEntry,
    hasTypescript,
    collectUsedPackages(sandpackFiles),
    cssSupport.nativeTailwindBuild
      ? ["tailwindcss", "postcss", "autoprefixer", "tailwindcss-animate"]
      : cssSupport.usesTailwindBuildDirectives
        ? ["twind"]
        : []
  );
  sandpackFiles["/index.html"] = normalizeIndexHtmlForRuntime(
    indexHtml,
    effectiveEntry,
    sandpackFiles,
    cssSupport.cssPath,
    cssSupport.includeTailwindCdn,
    cssSupport.inlineTailwindCss,
    cssSupport.tailwindRuntime,
    htmlEntry
  );

  const activeFile = entry || Object.keys(sandpackFiles)[0] || effectiveEntry;
  const environment = hasTypescript
    ? "create-react-app-typescript"
    : "create-react-app";

  return {
    files: sandpackFiles,
    dependencies,
    entry: effectiveEntry,
    environment,
    activeFile,
    fileCount: Object.keys(sandpackFiles).length,
    template: hasTypescript ? "vite-react-ts" : "vite-react",
  } as const;
}

export default function PreviewPanel({ onSendVisualPrompt }: PreviewPanelProps) {
  const activeProjectId = useBuilderStore((state) => state.activeProjectId);
  const files = useBuilderStore((state) => state.files);
  const updateFile = useBuilderStore((state) => state.updateFile);
  const [showLogs, setShowLogs] = useState(false);
  const [visualEditEnabled, setVisualEditEnabled] = useState(false);
  const [selectedElement, setSelectedElement] = useState<VisualElement | null>(null);
  const [sandboxRefreshKey, setSandboxRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSandboxRecoverAtRef = useRef(0);

  const isHostedClient = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1";
  }, []);

  const useBrowserPreview = isHostedClient;
  const sandpackProject = useMemo(() => buildSandpackProject(files), [files]);

  const {
    logs,
    port,
    isRunning,
    isStarting,
    error,
    isDisabled,
    startServer,
    stopServer,
    restartServer,
  } = useDevServerSocket(
    useBrowserPreview ? undefined : (activeProjectId || undefined)
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!useBrowserPreview || typeof window === "undefined") return;

    const maybeRecover = (message: string) => {
      if (!message.toLowerCase().includes("failed to get shell by id")) return;
      const now = Date.now();
      if (now - lastSandboxRecoverAtRef.current < 3000) return;
      lastSandboxRecoverAtRef.current = now;
      setSandboxRefreshKey((key) => key + 1);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      if (typeof reason === "string") {
        maybeRecover(reason);
        return;
      }
      if (reason instanceof Error) {
        maybeRecover(reason.message || "");
        return;
      }
      try {
        maybeRecover(JSON.stringify(reason ?? ""));
      } catch {
        // no-op
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      maybeRecover(event.message || "");
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, [useBrowserPreview]);

  const previewUrl = useMemo(() => {
    if (!port) return null;
    return `http://localhost:${port}`;
  }, [port]);

  const previewOrigin = useMemo(() => {
    if (!previewUrl) return null;
    try {
      return new URL(previewUrl).origin;
    } catch {
      return null;
    }
  }, [previewUrl]);

  const sendBridgeMessage = useCallback(
    (payload: BridgeMessage) => {
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage(payload, previewOrigin ?? "*");
    },
    [previewOrigin]
  );

  useEffect(() => {
    sendBridgeMessage({
      type: "forge:visual-edit:toggle",
      enabled: visualEditEnabled,
    });
  }, [visualEditEnabled, sendBridgeMessage]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const expectedSource = iframeRef.current?.contentWindow;
      if (!expectedSource || event.source !== expectedSource) return;
      if (previewOrigin && event.origin !== previewOrigin) return;

      const data = event.data as {
        source?: string;
        type?: string;
        payload?: unknown;
      };
      if (!data || data.source !== "forge-preview") return;
      if (data.type === "visual-select") {
        setSelectedElement(data.payload as VisualElement);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [previewOrigin]);

  const handleApplyVisualChange = async (change: VisualElementChange) => {
    if (!selectedElement || !activeProjectId) return;

    sendBridgeMessage({
      type: "forge:visual-edit:apply",
      change: {
        selector: selectedElement.selector,
        text: change.text,
        className: change.className,
        styles: change.styles,
      },
    });

    const { targetFile } = parseElementInstruction(selectedElement, change, files);
    const target = files[targetFile];
    if (!target) return;

    const updatedContent = applyQuickVisualEdit(
      target.content,
      selectedElement,
      change
    );
    if (updatedContent === target.content) return;

    updateFile(targetFile, updatedContent);
    const auth = await authHeaders();

    await fetch(apiUrl(`/api/projects/${activeProjectId}/files`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        filename: targetFile,
        content: updatedContent,
      }),
    });
  };

  const handleAskAI = (change: VisualElementChange) => {
    if (!selectedElement) return;
    const { prompt } = parseElementInstruction(selectedElement, change, files);
    onSendVisualPrompt(prompt);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
      <div className="panel-header flex h-[40px] shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/35 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {useBrowserPreview ? (
              <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">
                  Sandbox
                </span>
              </div>
            ) : isRunning ? (
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                  Live
                </span>
              </div>
            ) : isStarting ? (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500">
                  Booting
                </span>
              </div>
            ) : isDisabled ? (
              <div className="flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-orange-500">
                  Disabled
                </span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-red-500">
                  Error
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-2 py-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  Offline
                </span>
              </div>
            )}
            {!useBrowserPreview && port ? (
              <span className="font-mono text-[10px] text-gray-500">localhost:{port}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!useBrowserPreview ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-[10px] gap-1.5 transition-colors",
                  visualEditEnabled
                    ? "bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                    : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                )}
                onClick={() =>
                  setVisualEditEnabled((prev) => {
                    const next = !prev;
                    if (!next) {
                      setSelectedElement(null);
                    }
                    return next;
                  })
                }
              >
                <MousePointer2 className="h-3 w-3" />
                Visual Edit
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-[10px] gap-1.5 transition-colors",
                  showLogs
                    ? "bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200"
                    : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                )}
                onClick={() => setShowLogs((prev) => !prev)}
              >
                <TerminalIcon className="h-3 w-3" />
                Logs
              </Button>

              <div className="mx-1 h-3 w-[1px] bg-white/10" />
            </>
          ) : null}

          {useBrowserPreview ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
              onClick={() => setSandboxRefreshKey((key) => key + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          ) : isRunning ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => {
                  if (iframeRef.current) {
                    const src = iframeRef.current.src;
                    const separator = src.includes("?") ? "&" : "?";
                    iframeRef.current.src = `${src}${separator}refresh=${Date.now()}`;
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => {
                  if (!previewUrl) return;
                  const opened = window.open(
                    previewUrl,
                    "_blank",
                    "noopener,noreferrer"
                  );
                  if (opened) opened.opener = null;
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
                onClick={stopServer}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[10px] text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
              onClick={startServer}
              disabled={isStarting || isDisabled}
            >
              <Play className="h-3 w-3 fill-current" />
              {isDisabled ? "Dev Server Disabled" : isStarting ? "Starting..." : "Start Dev Server"}
            </Button>
          )}
        </div>
      </div>

      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
        {useBrowserPreview ? (
          sandpackProject.fileCount > 0 ? (
            <div className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden bg-[#0a0a0a]">
              <SandpackProvider
                key={`${activeProjectId ?? "project"}:${sandboxRefreshKey}:${sandpackProject.template}:${sandpackProject.environment}`}
                className="forge-sandpack-host"
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 0,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
                template={sandpackProject.template}
                files={sandpackProject.files}
                customSetup={{
                  dependencies: sandpackProject.dependencies,
                  entry: sandpackProject.entry,
                  environment: sandpackProject.environment,
                }}
                options={{
                  activeFile: sandpackProject.activeFile,
                  autoReload: true,
                }}
              >
                <SandpackPreview
                  showNavigator={false}
                  showOpenInCodeSandbox={false}
                  showRefreshButton
                  showRestartButton
                  style={{ width: "100%", height: "100%" }}
                  className="forge-sandpack-preview flex min-h-0 flex-1 [&_.sp-stack]:min-h-0 [&_.sp-stack]:h-full [&_.sp-stack]:w-full [&_.sp-preview]:min-h-0 [&_.sp-preview]:h-full [&_.sp-preview]:w-full [&_.sp-preview-container]:min-h-0 [&_.sp-preview-container]:h-full [&_.sp-preview-container]:w-full [&_.sp-preview-container]:flex-1 [&_.sp-preview-iframe]:block [&_.sp-preview-iframe]:min-h-0 [&_.sp-preview-iframe]:h-full [&_.sp-preview-iframe]:w-full [&_.sp-preview-iframe]:flex-1 [&_iframe]:block [&_iframe]:h-full [&_iframe]:w-full"
                />
              </SandpackProvider>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center bg-[#0a0a0a] p-6 text-center">
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-500/10">
                  <AlertCircle className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="mb-2 font-medium text-white">Waiting For Generated Files</h3>
                <p className="text-sm leading-relaxed text-gray-500">
                  Send a prompt to generate files. They will render here in a browser sandbox.
                </p>
              </div>
            </div>
          )
        ) : previewUrl && isRunning ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="h-full w-full bg-white transition-opacity duration-300"
            title="Preview"
            onLoad={() =>
              sendBridgeMessage({
                type: "forge:visual-edit:toggle",
                enabled: visualEditEnabled,
              })
            }
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-[#0a0a0a] p-6 text-center">
            {isDisabled ? (
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
                  <AlertCircle className="h-6 w-6 text-orange-400" />
                </div>
                <h3 className="mb-2 font-medium text-white">Dev Server Disabled</h3>
                <p className="text-sm leading-relaxed text-gray-500">
                  Live preview is disabled on this backend deployment. Enable untrusted code execution on the backend or run locally to use the dev server preview.
                </p>
              </div>
            ) : error ? (
              <div className="max-w-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <h3 className="mb-2 font-medium text-white">Development Server Failed</h3>
                <p className="mb-6 text-sm leading-relaxed text-gray-500">{error}</p>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={restartServer}
                    className="gap-2 bg-red-500 text-white transition-all active:scale-95 hover:bg-red-600"
                  >
                    <Zap className="h-4 w-4 fill-current" />
                    Attempt Auto-Fix & Restart
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowLogs(true)}
                    className="gap-2 border-white/15 text-slate-300 hover:bg-slate-800/60"
                  >
                    <TerminalIcon className="h-4 w-4" />
                    View Logs
                  </Button>
                </div>
              </div>
            ) : isStarting ? (
              <div className="flex flex-col items-center animate-in fade-in duration-500">
                <div className="relative mb-6 h-16 w-16">
                  <div className="absolute inset-0 rounded-xl border-2 border-cyan-500/20" />
                  <div className="absolute inset-0 animate-spin rounded-xl border-2 border-t-cyan-400" />
                  <Zap className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-cyan-300" />
                </div>
                <h3 className="mb-2 font-medium text-gray-200">Booting Environment</h3>
                <p className="max-w-[200px] text-sm leading-relaxed text-gray-500">
                  Running npm install and starting Vite dev server...
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center opacity-40 transition-opacity duration-500 hover:opacity-100">
                <Zap className="mb-4 h-12 w-12 text-gray-600" />
                <p className="mb-6 text-sm text-gray-500">
                  Development server is not running
                </p>
                <Button
                  onClick={startServer}
                  variant="outline"
                  className="border-slate-700 transition-all active:scale-95 hover:border-cyan-400/50 hover:bg-cyan-500/5"
                >
                  Start Environment
                </Button>
              </div>
            )}
          </div>
        )}

        {!useBrowserPreview && visualEditEnabled ? (
          <VisualEditOverlay
            key={selectedElement?.selector || "visual-overlay"}
            enabled={visualEditEnabled}
            selectedElement={selectedElement}
            onApply={handleApplyVisualChange}
            onAskAI={handleAskAI}
            onClose={() => {
              setVisualEditEnabled(false);
              setSelectedElement(null);
            }}
          />
        ) : null}

        {!useBrowserPreview && showLogs ? (
          <div className="absolute inset-x-0 bottom-0 z-20 flex h-1/2 flex-col animate-in slide-in-from-bottom border-t border-white/10 bg-slate-950/95 duration-300">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/70 px-4 py-2">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-3.5 w-3.5 text-cyan-300" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Logs
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                onClick={() => setShowLogs(false)}
              >
                <Square className="h-3 w-3 rotate-45" />
              </Button>
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed selection:bg-cyan-500/30"
            >
              {logs.length > 0 ? (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className="mb-0.5 break-all whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: converter.toHtml(log) }}
                  />
                ))
              ) : (
                <div className="flex h-full items-center justify-center italic text-gray-700">
                  No logs yet.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
