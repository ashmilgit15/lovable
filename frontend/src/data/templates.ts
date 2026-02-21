export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  thumbnail: string;
  prompt: string;
}

export const BUILDER_TEMPLATES: PromptTemplate[] = [
  {
    id: "saas-dashboard",
    name: "SaaS Dashboard",
    description: "Metrics-focused SaaS admin with charts, plans, and account controls.",
    tags: ["dashboard", "saas", "analytics"],
    thumbnail: "/templates/saas-dashboard.png",
    prompt:
      "Build a complete SaaS dashboard with KPI cards, revenue chart, team table, billing overview, and responsive sidebar navigation using React, TypeScript, Tailwind, shadcn/ui, React Query, and Zustand.",
  },
  {
    id: "landing-page",
    name: "Landing Page",
    description: "Marketing-first landing page with hero, social proof, and CTA blocks.",
    tags: ["marketing", "hero", "conversion"],
    thumbnail: "/templates/landing-page.png",
    prompt:
      "Create a polished startup landing page with hero, logo strip, feature sections, pricing cards, FAQ accordion, newsletter form, and animated CTA sections.",
  },
  {
    id: "ecommerce-store",
    name: "E-commerce Store",
    description: "Storefront template with catalog, filters, cart, and checkout UI.",
    tags: ["commerce", "catalog", "cart"],
    thumbnail: "/templates/ecommerce.png",
    prompt:
      "Generate an e-commerce frontend with category filters, searchable product grid, product detail modal, cart drawer, and checkout form with validation.",
  },
  {
    id: "blog",
    name: "Blog",
    description: "Modern editorial layout with post list, article page, and newsletter.",
    tags: ["content", "editorial", "posts"],
    thumbnail: "/templates/blog.png",
    prompt:
      "Build a blog app layout with featured article hero, article cards, category filter tabs, reading page structure, and newsletter subscription section.",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Personal portfolio with project gallery, timeline, and contact form.",
    tags: ["portfolio", "personal", "showcase"],
    thumbnail: "/templates/portfolio.png",
    prompt:
      "Create a creative developer portfolio with hero intro, project gallery, skills grid, timeline experience section, and contact form using react-hook-form and zod.",
  },
  {
    id: "admin-panel",
    name: "Admin Panel",
    description: "Operations-focused admin shell with data tables and controls.",
    tags: ["admin", "table", "management"],
    thumbnail: "/templates/admin.png",
    prompt:
      "Create an admin panel with collapsible sidebar, sortable user table, status badges, bulk actions, and settings forms with validation and loading states.",
  },
  {
    id: "todo-app",
    name: "Todo App",
    description: "Task manager with categories, priorities, and progress tracking.",
    tags: ["productivity", "tasks", "kanban-lite"],
    thumbnail: "/templates/todo.png",
    prompt:
      "Build a feature-rich todo app with task creation/editing, due dates, priorities, filters, completion progress, and local persistence via Zustand.",
  },
  {
    id: "chat-app",
    name: "Chat App",
    description: "Conversation UI with channel list, live thread, and typing status.",
    tags: ["chat", "messaging", "realtime-ui"],
    thumbnail: "/templates/chat.png",
    prompt:
      "Build a chat interface with conversation sidebar, active thread panel, message composer, typing indicator, and unread state badges.",
  },
  {
    id: "kanban-board",
    name: "Kanban Board",
    description: "Board-style workflow with draggable cards and progress lanes.",
    tags: ["kanban", "workflow", "tasks"],
    thumbnail: "/templates/kanban.png",
    prompt:
      "Create a kanban board with columns, draggable cards, quick card editor, priority labels, and responsive mobile lane view.",
  },
  {
    id: "analytics-dashboard",
    name: "Analytics Dashboard",
    description: "Data-heavy dashboard with charts, trends, and time filters.",
    tags: ["analytics", "charts", "insights"],
    thumbnail: "/templates/analytics.png",
    prompt:
      "Generate an analytics dashboard with trend charts, cohort cards, traffic source breakdown, date range controls, and export action buttons.",
  },
];
