import json
import os
import re
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass, asdict
from sqlmodel import Session, select

from models import Project, ProjectFile, ChatMessage, utcnow



@dataclass
class ProjectMemory:
    stack: list[str]
    components: list[str]
    color_scheme: str
    auth: bool
    database: str
    key_decisions: list[str]
    last_10_changes: list[str]
    features: list[str]
    styling: str
    state_management: str


MEMORY_DEFAULTS = ProjectMemory(
    stack=["React", "TypeScript", "Vite", "TailwindCSS"],
    components=[],
    color_scheme="dark violet and emerald",
    auth=False,
    database="none",
    key_decisions=[],
    last_10_changes=[],
    features=[],
    styling="TailwindCSS with shadcn/ui",
    state_management="Zustand",
)


def get_memory_path(project_id: str) -> str:
    base_dir = os.path.abspath(f"./generated/{project_id}")
    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, "memory.json")


def load_memory(project_id: str) -> ProjectMemory:
    memory_path = get_memory_path(project_id)
    if os.path.exists(memory_path):
        try:
            with open(memory_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return ProjectMemory(**{**asdict(MEMORY_DEFAULTS), **data})
        except (json.JSONDecodeError, TypeError):
            pass
    return ProjectMemory(**asdict(MEMORY_DEFAULTS))


def save_memory(project_id: str, memory: ProjectMemory):
    memory_path = get_memory_path(project_id)
    with open(memory_path, "w", encoding="utf-8") as f:
        json.dump(asdict(memory), f, indent=2, default=str)


def extract_components_from_files(files: list[ProjectFile]) -> list[str]:
    components = set()
    component_pattern = re.compile(r"(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=\(]")

    for f in files:
        if f.filename.endswith((".tsx", ".jsx")):
            matches = component_pattern.findall(f.content)
            for match in matches:
                if match not in [
                    "App",
                    "React",
                    "useState",
                    "useEffect",
                    "useRef",
                    "useCallback",
                    "useMemo",
                ]:
                    components.add(match)

    return sorted(list(components))


def extract_features_from_content(content: str) -> list[str]:
    features = set()
    feature_keywords = {
        "form": "Forms",
        "api": "API Integration",
        "auth": "Authentication",
        "login": "Login System",
        "register": "Registration",
        "dashboard": "Dashboard",
        "table": "Data Tables",
        "chart": "Charts/Analytics",
        "search": "Search Functionality",
        "filter": "Filtering",
        "pagination": "Pagination",
        "upload": "File Upload",
        "download": "File Download",
        "modal": "Modal Dialogs",
        "toast": "Toast Notifications",
        "dark mode": "Dark Mode",
        "responsive": "Responsive Design",
        "animation": "Animations",
        "websocket": "Real-time Updates",
        "socket": "WebSocket",
        "stripe": "Payment Integration",
        "payment": "Payment System",
        "cart": "Shopping Cart",
        "checkout": "Checkout Flow",
        "user profile": "User Profiles",
        "settings": "Settings Page",
        "admin": "Admin Panel",
        "navigation": "Navigation",
        "sidebar": "Sidebar Layout",
        "header": "Header Component",
        "footer": "Footer Component",
        "landing": "Landing Page",
        "blog": "Blog Section",
        "comment": "Comments System",
        "rating": "Rating System",
        "like": "Like/Reaction System",
        "share": "Share Functionality",
        "export": "Export Data",
        "import": "Import Data",
    }

    content_lower = content.lower()
    for keyword, feature in feature_keywords.items():
        if keyword in content_lower and feature not in features:
            features.add(feature)

    return sorted(list(features))


def detect_color_scheme(files: list[ProjectFile]) -> str:
    colors = set()
    color_patterns = [
        re.compile(r"violet|purple", re.IGNORECASE),
        re.compile(r"emerald|green", re.IGNORECASE),
        re.compile(r"blue|indigo", re.IGNORECASE),
        re.compile(r"red|rose", re.IGNORECASE),
        re.compile(r"orange|amber", re.IGNORECASE),
        re.compile(r"pink", re.IGNORECASE),
        re.compile(r"cyan|teal", re.IGNORECASE),
    ]

    for f in files:
        if f.filename.endswith((".tsx", ".jsx", ".css", ".ts", ".js")):
            for pattern in color_patterns:
                if pattern.search(f.content):
                    colors.add(pattern.pattern.split("|")[0].lower())

    if colors:
        return f"dark {', '.join(sorted(colors))}"
    return "dark violet and emerald"


def detect_auth(content: str) -> bool:
    auth_indicators = [
        "auth",
        "login",
        "signin",
        "signup",
        "register",
        "jwt",
        "session",
        "token",
        "logout",
    ]
    content_lower = content.lower()
    return any(indicator in content_lower for indicator in auth_indicators)


def detect_database(content: str) -> str:
    db_indicators = {
        "supabase": "Supabase",
        "firebase": "Firebase",
        "mongodb": "MongoDB",
        "postgres": "PostgreSQL",
        "mysql": "MySQL",
        "sqlite": "SQLite",
        "prisma": "Prisma",
        "drizzle": "Drizzle ORM",
    }
    content_lower = content.lower()
    for indicator, db_name in db_indicators.items():
        if indicator in content_lower:
            return db_name
    return "none"


def summarize_change(user_message: str, files_changed: list[str]) -> str:
    msg_lower = user_message.lower()

    if any(
        word in msg_lower for word in ["create", "build", "generate", "make", "add"]
    ):
        action = "Added"
    elif any(word in msg_lower for word in ["fix", "debug", "resolve", "solve"]):
        action = "Fixed"
    elif any(
        word in msg_lower
        for word in ["update", "modify", "change", "improve", "enhance"]
    ):
        action = "Updated"
    elif any(word in msg_lower for word in ["remove", "delete", "clean"]):
        action = "Removed"
    else:
        action = "Modified"

    if files_changed:
        return f"{action} {', '.join(files_changed[:3])}"
    return f"{action} feature"


def update_memory_from_generation(
    project_id: str, user_message: str, files_changed: list[str], session: Session
):
    memory = load_memory(project_id)

    all_files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()

    memory.components = extract_components_from_files(list(all_files))

    all_content = " ".join([f.content for f in all_files])
    memory.features = extract_features_from_content(all_content)
    memory.color_scheme = detect_color_scheme(list(all_files))
    memory.auth = detect_auth(all_content)
    memory.database = detect_database(all_content)

    change_summary = summarize_change(user_message, files_changed)
    memory.last_10_changes.insert(0, change_summary)
    memory.last_10_changes = memory.last_10_changes[:10]

    if len(files_changed) > 0:
        decision = f"Modified {', '.join(files_changed[:2])}"
        if decision not in memory.key_decisions:
            memory.key_decisions.insert(0, decision)
            memory.key_decisions = memory.key_decisions[:20]

    save_memory(project_id, memory)
    return memory


def get_memory_context(project_id: str) -> str:
    memory = load_memory(project_id)

    context_parts = [
        f"Project Context:",
        f"- Stack: {', '.join(memory.stack)}",
        f"- Styling: {memory.styling}",
        f"- State: {memory.state_management}",
        f"- Color Scheme: {memory.color_scheme}",
    ]

    if memory.components:
        context_parts.append(f"- Components: {', '.join(memory.components[:10])}")

    if memory.features:
        context_parts.append(f"- Features: {', '.join(memory.features[:5])}")

    if memory.auth:
        context_parts.append(f"- Authentication: Enabled")

    if memory.database != "none":
        context_parts.append(f"- Database: {memory.database}")

    if memory.last_10_changes:
        context_parts.append(f"- Recent Changes: {memory.last_10_changes[0]}")

    return "\n".join(context_parts)


def clear_memory(project_id: str):
    memory_path = get_memory_path(project_id)
    if os.path.exists(memory_path):
        os.remove(memory_path)
    save_memory(project_id, ProjectMemory(**asdict(MEMORY_DEFAULTS)))
