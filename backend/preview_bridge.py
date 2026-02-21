import os
from sqlmodel import Session, select

from models import ProjectFile, utcnow

BRIDGE_FILENAME = "public/forge-bridge.js"
BRIDGE_SCRIPT_TAG = '<script src="/forge-bridge.js"></script>'

BRIDGE_SCRIPT = """(() => {
  if (window.__forgeBridgeInstalled) return;
  window.__forgeBridgeInstalled = true;

  let visualEditEnabled = false;
  let lastSelected = null;
  let hoverEl = null;
  const parentOrigin = (() => {
    try {
      if (document.referrer) {
        return new URL(document.referrer).origin;
      }
    } catch {}
    return "*";
  })();

  const highlight = document.createElement("div");
  highlight.style.position = "fixed";
  highlight.style.border = "2px solid #8b5cf6";
  highlight.style.background = "rgba(139, 92, 246, 0.12)";
  highlight.style.pointerEvents = "none";
  highlight.style.zIndex = "2147483647";
  highlight.style.display = "none";
  highlight.style.borderRadius = "8px";
  document.documentElement.appendChild(highlight);

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    html.forge-visual-edit, html.forge-visual-edit * {
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(styleTag);

  function buildSelector(el) {
    if (!el || !(el instanceof Element)) return "";
    if (el.id) return `#${el.id}`;

    const parts = [];
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) break;
      const index = Array.from(parent.children).indexOf(node) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
      node = parent;
    }
    return parts.join(" > ");
  }

  function elementPayload(el) {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 300),
      className: el.className || "",
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      styles: {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        padding: computed.padding,
        fontSize: computed.fontSize,
      },
    };
  }

  function post(type, payload) {
    window.parent.postMessage(
      {
        source: "forge-preview",
        type,
        payload,
      },
      parentOrigin
    );
  }

  function setHighlight(el) {
    if (!el) {
      highlight.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  document.addEventListener("mousemove", (event) => {
    if (!visualEditEnabled) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el === hoverEl || el === highlight) return;

    hoverEl = el;
    setHighlight(el);
    post("visual-hover", elementPayload(el));
  }, true);

  document.addEventListener("mouseleave", () => {
    if (!visualEditEnabled) return;
    hoverEl = null;
    setHighlight(null);
  }, true);

  document.addEventListener("click", (event) => {
    if (!visualEditEnabled) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el === highlight) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    lastSelected = el;
    setHighlight(el);
    post("visual-select", elementPayload(el));
  }, true);

  function applyChanges(change) {
    if (!change) return;
    const selector = change.selector || (lastSelected ? buildSelector(lastSelected) : "");
    const target = selector ? document.querySelector(selector) : lastSelected;
    if (!target) return;

    if (typeof change.text === "string") {
      target.textContent = change.text;
    }

    if (typeof change.className === "string") {
      target.className = change.className;
    }

    if (change.styles && typeof change.styles === "object") {
      for (const [key, value] of Object.entries(change.styles)) {
        if (typeof value === "string") {
          target.style[key] = value;
        }
      }
    }

    lastSelected = target;
    setHighlight(target);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;

    const data = event.data || {};
    if (data.type === "forge:visual-edit:toggle") {
      visualEditEnabled = Boolean(data.enabled);
      if (visualEditEnabled) {
        document.documentElement.classList.add("forge-visual-edit");
      } else {
        document.documentElement.classList.remove("forge-visual-edit");
        setHighlight(null);
      }
    }

    if (data.type === "forge:visual-edit:apply") {
      applyChanges(data.change || {});
    }
  });

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    post("runtime-error", {
      level: "error",
      message: args.map((item) => {
        if (typeof item === "string") return item;
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }).join(" "),
    });
    originalError(...args);
  };

  window.addEventListener("error", (event) => {
    post("runtime-error", {
      level: "error",
      message: event.message || "Runtime error",
      source: event.filename || "",
      line: event.lineno || 0,
      column: event.colno || 0,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    post("runtime-error", {
      level: "error",
      message: event.reason ? String(event.reason) : "Unhandled promise rejection",
    });
  });

  post("bridge-ready", { href: window.location.href });
})();"""


def ensure_preview_bridge(project_id: str, session: Session):
    base_dir = os.path.abspath(f"./generated/{project_id}")
    os.makedirs(base_dir, exist_ok=True)

    bridge_path = os.path.join(base_dir, BRIDGE_FILENAME)
    os.makedirs(os.path.dirname(bridge_path), exist_ok=True)
    with open(bridge_path, "w", encoding="utf-8") as bridge_file:
        bridge_file.write(BRIDGE_SCRIPT)
    upsert_project_file(session, project_id, BRIDGE_FILENAME, BRIDGE_SCRIPT, "javascript")

    index_candidates = ["index.html", "public/index.html"]
    found_index = False

    for filename in index_candidates:
        path = os.path.join(base_dir, filename)
        if not os.path.exists(path):
            continue

        found_index = True
        with open(path, "r", encoding="utf-8") as index_file:
            content = index_file.read()

        updated = inject_bridge_tag(content)
        if updated != content:
            with open(path, "w", encoding="utf-8") as index_file:
                index_file.write(updated)
            upsert_project_file(session, project_id, filename, updated, "html")

    if not found_index:
        scaffold_index = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge Project</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/forge-bridge.js"></script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""
        index_path = os.path.join(base_dir, "index.html")
        with open(index_path, "w", encoding="utf-8") as index_file:
            index_file.write(scaffold_index)
        upsert_project_file(session, project_id, "index.html", scaffold_index, "html")


def inject_bridge_tag(content: str) -> str:
    if "/forge-bridge.js" in content:
        return content

    if "</body>" in content:
        return content.replace("</body>", f"  {BRIDGE_SCRIPT_TAG}\n</body>")

    return f"{content}\n{BRIDGE_SCRIPT_TAG}\n"


def upsert_project_file(
    session: Session,
    project_id: str,
    filename: str,
    content: str,
    language: str,
):
    existing = session.exec(
        select(ProjectFile).where(
            ProjectFile.project_id == project_id,
            ProjectFile.filename == filename,
        )
    ).first()

    if existing:
        existing.content = content
        existing.language = language
        existing.updated_at = utcnow()
        session.add(existing)
        return

    session.add(
        ProjectFile(
            project_id=project_id,
            filename=filename,
            content=content,
            language=language,
        )
    )
