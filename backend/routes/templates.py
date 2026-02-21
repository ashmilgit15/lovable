from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select
from sqlalchemy import or_
import json

from database import get_session
from auth import get_request_user_id
from models import Project, ProjectFile, ProjectTemplate
from routes.projects import scaffold_project

router = APIRouter(prefix="/api/templates", tags=["templates"])


BUILTIN_TEMPLATES = [
    {
        "id": "saas-dashboard",
        "name": "SaaS Dashboard",
        "description": "Modern SaaS dashboard with analytics, charts, and user management",
        "prompt": "Build a modern SaaS dashboard application with:\n- Dark theme with violet accent colors\n- Sidebar navigation with icons\n- Top header with search and user profile\n- Dashboard overview with metric cards (revenue, users, growth)\n- Line chart for analytics visualization\n- Recent activity feed\n- User management table with actions\n- Responsive layout for mobile\n- Use recharts for charts\n- Include lucide-react icons",
        "tags": ["dashboard", "saas", "analytics", "admin"],
        "thumbnail": "/templates/saas-dashboard.png",
    },
    {
        "id": "landing-page",
        "name": "Landing Page",
        "description": "Beautiful marketing landing page with hero, features, and CTA sections",
        "prompt": "Build a stunning landing page for a tech startup with:\n- Gradient hero section with headline, subheadline, and CTA buttons\n- Feature showcase with icons and descriptions in a grid\n- Testimonials carousel section\n- Pricing comparison table with three tiers\n- FAQ accordion section\n- Newsletter signup form\n- Footer with links and social icons\n- Smooth scroll animations\n- Fully responsive design\n- Use violet and emerald as accent colors",
        "tags": ["landing", "marketing", "startup", "responsive"],
        "thumbnail": "/templates/landing-page.png",
    },
    {
        "id": "ecommerce-store",
        "name": "E-commerce Store",
        "description": "Full e-commerce frontend with product catalog and cart",
        "prompt": "Build an e-commerce store frontend with:\n- Product grid with images, prices, and add to cart buttons\n- Product detail modal with size/color selection\n- Shopping cart sidebar with item management\n- Search and filter functionality\n- Category navigation\n- Hero banner section\n- Featured products section\n- Checkout flow with form validation\n- Use placeholder product images\n- Responsive grid layout",
        "tags": ["ecommerce", "store", "shopping", "cart"],
        "thumbnail": "/templates/ecommerce.png",
    },
    {
        "id": "blog-platform",
        "name": "Blog Platform",
        "description": "Modern blog with posts, categories, and reading experience",
        "prompt": "Build a blog platform with:\n- Blog post list with featured image, title, excerpt, and date\n- Single post view with full content and related posts\n- Sidebar with categories and recent posts\n- Search functionality\n- Author bio section\n- Comment section with form\n- Newsletter subscription\n- Social share buttons\n- Dark reading mode\n- Responsive typography",
        "tags": ["blog", "content", "articles", "reading"],
        "thumbnail": "/templates/blog.png",
    },
    {
        "id": "portfolio-site",
        "name": "Portfolio Site",
        "description": "Personal portfolio showcasing projects and skills",
        "prompt": "Build a personal portfolio website with:\n- Hero section with name, title, and animated background\n- About me section with photo and bio\n- Skills section with progress bars or tags\n- Projects showcase with images and links\n- Work experience timeline\n- Contact form with validation\n- Social links in footer\n- Smooth animations on scroll\n- Minimalist dark design\n- Mobile responsive",
        "tags": ["portfolio", "personal", "showcase", "creative"],
        "thumbnail": "/templates/portfolio.png",
    },
    {
        "id": "admin-panel",
        "name": "Admin Panel",
        "description": "Admin dashboard with data tables and user management",
        "prompt": "Build an admin panel with:\n- Sidebar navigation with collapse functionality\n- Data tables with sorting, filtering, pagination\n- User management with CRUD operations\n- Settings page with forms\n- Activity log section\n- Search functionality\n- Bulk actions for table rows\n- Modal dialogs for editing\n- Toast notifications\n- Dark theme with professional styling",
        "tags": ["admin", "dashboard", "management", "crud"],
        "thumbnail": "/templates/admin.png",
    },
    {
        "id": "todo-app",
        "name": "Todo App",
        "description": "Productivity todo application with categories and due dates",
        "prompt": "Build a todo application with:\n- Todo list with add, edit, delete functionality\n- Mark todos as complete with strikethrough\n- Categories/tags for organizing todos\n- Due date picker\n- Priority levels (high, medium, low)\n- Filter by status and category\n- Search through todos\n- Progress indicator\n- Local storage persistence\n- Clean, minimal interface",
        "tags": ["todo", "productivity", "tasks", "organization"],
        "thumbnail": "/templates/todo.png",
    },
    {
        "id": "chat-app",
        "name": "Chat App",
        "description": "Real-time chat interface with conversations and messages",
        "prompt": "Build a chat application with:\n- Conversation list sidebar\n- Chat message area with bubble messages\n- Message input with send button\n- User avatars and status indicators\n- Timestamps on messages\n- Typing indicator animation\n- Message search functionality\n- New conversation button\n- Emoji picker integration\n- Responsive split layout",
        "tags": ["chat", "messaging", "communication", "realtime"],
        "thumbnail": "/templates/chat.png",
    },
    {
        "id": "kanban-board",
        "name": "Kanban Board",
        "description": "Project management kanban board with drag and drop",
        "prompt": "Build a kanban board with:\n- Multiple columns (To Do, In Progress, Review, Done)\n- Draggable cards between columns\n- Card with title, description, tags, due date\n- Add new card functionality\n- Edit card modal\n- Delete card with confirmation\n- Color-coded priority labels\n- Column header with card count\n- Smooth drag animations\n- Save state to local storage",
        "tags": ["kanban", "project", "management", "drag-drop"],
        "thumbnail": "/templates/kanban.png",
    },
    {
        "id": "analytics-dashboard",
        "name": "Analytics Dashboard",
        "description": "Data visualization dashboard with charts and metrics",
        "prompt": "Build an analytics dashboard with:\n- Key metrics cards at the top\n- Line chart for trends over time\n- Bar chart for comparisons\n- Pie/donut chart for distributions\n- Date range selector\n- Comparison period toggle\n- Data table with detailed breakdown\n- Export functionality button\n- Refresh button with animation\n- Grid layout for charts\n- Use recharts library",
        "tags": ["analytics", "charts", "data", "visualization"],
        "thumbnail": "/templates/analytics.png",
    },
]


class TemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    tags: List[str]
    thumbnail: Optional[str]
    is_builtin: bool
    prompt: str


class CreateFromTemplate(BaseModel):
    name: str
    template_id: str


def _normalize_owner_id(user_id: str | None) -> str:
    return (user_id or "local").strip() or "local"


def _template_owner_filter(user_id: str | None):
    normalized = _normalize_owner_id(user_id)
    if normalized == "local":
        return or_(ProjectTemplate.owner_id == "local", ProjectTemplate.owner_id.is_(None))
    return ProjectTemplate.owner_id == normalized


def _list_templates_for_user(session: Session, user_id: str) -> list[TemplateResponse]:
    templates: list[TemplateResponse] = []

    for t in BUILTIN_TEMPLATES:
        templates.append(
            TemplateResponse(
                id=t["id"],
                name=t["name"],
                description=t["description"],
                tags=t["tags"],
                thumbnail=t.get("thumbnail"),
                is_builtin=True,
                prompt=t["prompt"],
            )
        )

    custom_templates = session.exec(
        select(ProjectTemplate).where(
            ProjectTemplate.is_builtin == False,  # noqa: E712
            _template_owner_filter(user_id),
        )
    ).all()

    for t in custom_templates:
        templates.append(
            TemplateResponse(
                id=t.id,
                name=t.name,
                description=t.description,
                prompt=t.prompt,
                tags=json.loads(t.tags) if t.tags else [],
                thumbnail=t.thumbnail,
                is_builtin=False,
            )
        )

    return templates


def _resolve_custom_template_for_user(
    session: Session,
    template_id: str,
    user_id: str,
) -> ProjectTemplate | None:
    return session.exec(
        select(ProjectTemplate).where(
            ProjectTemplate.id == template_id,
            _template_owner_filter(user_id),
        )
    ).first()


@router.get("", response_model=List[TemplateResponse])
def list_templates(request: Request, session: Session = Depends(get_session)):
    user_id = _normalize_owner_id(get_request_user_id(request))
    return _list_templates_for_user(session, user_id)


@router.get("/paged")
def list_templates_paged(
    request: Request,
    session: Session = Depends(get_session),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
):
    user_id = _normalize_owner_id(get_request_user_id(request))
    templates = _list_templates_for_user(session, user_id)

    if search and search.strip():
        token = search.strip().lower()
        templates = [
            item
            for item in templates
            if token in item.name.lower()
            or token in item.description.lower()
            or any(token in tag.lower() for tag in item.tags)
        ]

    total = len(templates)
    items = templates[offset : offset + limit]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


@router.get("/{template_id}", response_model=TemplateResponse)
def get_template(
    template_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = _normalize_owner_id(get_request_user_id(request))
    for t in BUILTIN_TEMPLATES:
        if t["id"] == template_id:
            return TemplateResponse(
                id=t["id"],
                name=t["name"],
                description=t["description"],
                tags=t["tags"],
                thumbnail=t.get("thumbnail"),
                is_builtin=True,
                prompt=t["prompt"],
            )

    template = _resolve_custom_template_for_user(session, template_id, user_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return TemplateResponse(
        id=template.id,
        name=template.name,
        description=template.description,
        prompt=template.prompt,
        tags=json.loads(template.tags) if template.tags else [],
        thumbnail=template.thumbnail,
        is_builtin=False,
    )


@router.post("/from-template")
def create_from_template(
    data: CreateFromTemplate,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = _normalize_owner_id(get_request_user_id(request))
    template_prompt = None

    for t in BUILTIN_TEMPLATES:
        if t["id"] == data.template_id:
            template_prompt = t["prompt"]
            break

    if not template_prompt:
        template = _resolve_custom_template_for_user(session, data.template_id, user_id)
        if template:
            template_prompt = template.prompt

    if not template_prompt:
        raise HTTPException(status_code=404, detail="Template not found")

    project = Project(name=data.name, owner_id=user_id)
    session.add(project)
    session.flush()

    scaffold_files = scaffold_project(project.id)

    for filename, content in scaffold_files.items():
        ext = filename.rsplit(".", 1)[-1] if "." in filename else None
        lang_map = {
            "tsx": "typescript",
            "ts": "typescript",
            "jsx": "javascript",
            "js": "javascript",
            "html": "html",
            "css": "css",
            "json": "json",
        }
        lang = lang_map.get(ext, "plaintext")
        pf = ProjectFile(
            project_id=project.id, filename=filename, content=content, language=lang
        )
        session.add(pf)

    session.commit()
    session.refresh(project)

    return {"project": project, "initial_prompt": template_prompt}


class SaveTemplate(BaseModel):
    name: str
    description: str
    prompt: str
    tags: List[str] = []


@router.post("", response_model=TemplateResponse)
def save_custom_template(
    data: SaveTemplate,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = _normalize_owner_id(get_request_user_id(request))
    template = ProjectTemplate(
        owner_id=user_id,
        name=data.name,
        description=data.description,
        prompt=data.prompt,
        tags=json.dumps(data.tags),
        is_builtin=False,
    )
    session.add(template)
    session.commit()
    session.refresh(template)

    return TemplateResponse(
        id=template.id,
        name=template.name,
        description=template.description,
        prompt=template.prompt,
        tags=data.tags,
        thumbnail=template.thumbnail,
        is_builtin=False,
    )


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = _normalize_owner_id(get_request_user_id(request))
    template = _resolve_custom_template_for_user(session, template_id, user_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.is_builtin:
        raise HTTPException(status_code=400, detail="Cannot delete builtin templates")

    session.delete(template)
    session.commit()
    return {"ok": True}
