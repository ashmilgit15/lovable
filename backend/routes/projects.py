from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from sqlalchemy import func, or_
from pydantic import BaseModel
from typing import Optional
import asyncio
import os
import zipfile
import shutil

from database import get_session
from models import Project, ProjectFile, ChatMessage, utcnow
from auth import get_request_user_id
from project_access import (
    claim_legacy_projects_for_user,
    require_project_for_user,
    owned_project_filter,
)
from preview_bridge import ensure_preview_bridge
from autofix import run_project_autofix
from runtime_security import is_untrusted_code_execution_enabled
from ai import sanitize_assistant_message_text

def is_safe_path(base_dir: str, filename: str) -> bool:
    """Check if the filename stays within the base_dir."""
    abs_base = os.path.abspath(base_dir)
    abs_target = os.path.abspath(os.path.join(abs_base, filename))
    return os.path.commonpath([abs_base, abs_target]) == abs_base

router = APIRouter(prefix="/api/projects", tags=["projects"])

def scaffold_project(project_id: str):
    """
    Creates the initial file structure for a new project on disk.
    """
    base_dir = os.path.abspath(f"./generated/{project_id}")

    # Create directories
    os.makedirs(os.path.join(base_dir, "src"), exist_ok=True)
    os.makedirs(os.path.join(base_dir, "public"), exist_ok=True)

    # Define file content
    files = {
        "package.json": '''{
  "name": "one-project",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.469.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react-swc": "^3.5.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.16",
    "globals": "^15.14.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "~5.6.2",
    "typescript-eslint": "^8.18.2",
    "vite": "^6.0.5"
  }
}''',
        "vite.config.ts": '''import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})''',
        "tsconfig.json": '''{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}''',
        "tsconfig.app.json": '''{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}''',
        "tsconfig.node.json": '''{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}''',
        "postcss.config.js": '''export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}''',
        "tailwind.config.js": '''/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}''',
        "src/index.css": '''@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;

    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;

    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;

    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;

    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;

    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;

    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;

    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;

    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;

    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;

    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;

    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;

    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;

    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;

    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;

    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;

    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}''',
        "src/main.tsx": '''import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)''',
        "src/App.tsx": '''import { useState } from 'react'

function App() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to One
        </h1>
        <p className="text-muted-foreground">
          Your AI-generated app is ready to be built.
        </p>
      </div>
    </div>
  )
}

export default App''',
        "index.html": '''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>One Project</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/forge-bridge.js"></script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>'''
    }

    # Write files to disk
    for filename, content in files.items():
        if not is_safe_path(base_dir, filename):
            continue
            
        filepath = os.path.join(base_dir, filename)
        # Ensure subdirectory exists for nested files
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

    return files


def detect_language(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1] if "." in filename else None
    lang_map = {
        "tsx": "typescript",
        "ts": "typescript",
        "jsx": "javascript",
        "js": "javascript",
        "html": "html",
        "css": "css",
        "json": "json",
        "md": "markdown",
    }
    return lang_map.get(ext, "plaintext")

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    auto_fix_enabled: bool = True


class ProjectCreateFromTemplate(BaseModel):
    name: str
    prompt: str
    description: Optional[str] = None
    auto_fix_enabled: bool = True


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    auto_fix_enabled: Optional[bool] = None


@router.post("")
def create_project(
    data: ProjectCreate,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = get_request_user_id(request)
    project = Project(
        owner_id=user_id,
        name=data.name,
        description=data.description,
        auto_fix_enabled=data.auto_fix_enabled,
    )
    session.add(project)
    session.flush()

    # Create scaffold on disk
    scaffold_files = scaffold_project(project.id)

    # Also save scaffold files to DB for the preview/chat context
    for filename, content in scaffold_files.items():
        pf = ProjectFile(
            project_id=project.id,
            filename=filename,
            content=content,
            language=detect_language(filename),
        )
        session.add(pf)

    ensure_preview_bridge(project.id, session)

    session.commit()
    session.refresh(project)
    return project


@router.post("/from-template")
def create_project_from_template(
    data: ProjectCreateFromTemplate,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = get_request_user_id(request)
    project = Project(
        owner_id=user_id,
        name=data.name,
        description=data.description,
        auto_fix_enabled=data.auto_fix_enabled,
    )
    session.add(project)
    session.flush()

    scaffold_files = scaffold_project(project.id)
    for filename, content in scaffold_files.items():
        session.add(
            ProjectFile(
                project_id=project.id,
                filename=filename,
                content=content,
                language=detect_language(filename),
            )
        )

    ensure_preview_bridge(project.id, session)

    session.commit()
    session.refresh(project)

    return {"project": project, "initial_prompt": data.prompt}


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    data: ProjectUpdate,
    request: Request,
    session: Session = Depends(get_session),
):
    request_user_id = get_request_user_id(request)
    project = require_project_for_user(session, project_id, request_user_id)

    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    if data.auto_fix_enabled is not None:
        project.auto_fix_enabled = data.auto_fix_enabled

    project.updated_at = utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.get("")
def list_projects(request: Request, session: Session = Depends(get_session)):
    user_id = get_request_user_id(request)
    claim_legacy_projects_for_user(session, user_id)
    projects = session.exec(
        select(Project)
        .where(owned_project_filter(user_id))
        .order_by(Project.updated_at.desc())
    ).all()
    return projects


@router.get("/paged")
def list_projects_paged(
    request: Request,
    session: Session = Depends(get_session),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
):
    user_id = get_request_user_id(request)
    claim_legacy_projects_for_user(session, user_id)
    owner_filter = owned_project_filter(user_id)
    query = select(Project).where(owner_filter)
    count_query = select(func.count()).select_from(Project).where(owner_filter)

    if search and search.strip():
        token = f"%{search.strip()}%"
        search_filter = or_(
            Project.name.ilike(token),
            Project.description.ilike(token),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    total = int(session.exec(count_query).one() or 0)
    items = session.exec(
        query.order_by(Project.updated_at.desc()).offset(offset).limit(limit)
    ).all()

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
    }


@router.get("/{project_id}")
def get_project(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    project = require_project_for_user(session, project_id, get_request_user_id(request))

    files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()

    messages = session.exec(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at)
    ).all()

    serialized_messages = []
    for message in messages:
        message_content = message.content
        if message.role == "assistant":
            message_content = sanitize_assistant_message_text(message_content)
            if not message_content:
                message_content = "Generation complete."
        serialized_messages.append(
            {
                "id": message.id,
                "project_id": message.project_id,
                "role": message.role,
                "content": message_content,
                "created_at": message.created_at,
                "model_used": message.model_used,
            }
        )

    return {
        "project": project,
        "files": files,
        "messages": serialized_messages,
    }


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    project = require_project_for_user(session, project_id, get_request_user_id(request))

    # Clean up files on disk
    base_dir = os.path.abspath(f"./generated/{project_id}")
    if os.path.exists(base_dir):
        shutil.rmtree(base_dir)

    session.delete(project)
    session.commit()
    return {"ok": True}

class FileUpdate(BaseModel):
    filename: str
    content: str

@router.put("/{project_id}/files")
async def update_file(
    project_id: str,
    data: FileUpdate,
    request: Request,
    session: Session = Depends(get_session),
):
    request_user_id = get_request_user_id(request)
    project = require_project_for_user(session, project_id, request_user_id)
    base_dir = os.path.abspath(f"./generated/{project_id}")
    filename = (data.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    if not is_safe_path(base_dir, filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Update in DB
    file = session.exec(
        select(ProjectFile).where(
            ProjectFile.project_id == project_id,
            ProjectFile.filename == filename
        )
    ).first()

    if file:
        file.content = data.content
        file.updated_at = utcnow()
        file.language = file.language or detect_language(filename)
        session.add(file)
    else:
        file = ProjectFile(
            project_id=project_id,
            filename=filename,
            content=data.content,
            language=detect_language(filename),
        )
        session.add(file)

    ensure_preview_bridge(project_id, session)

    project.updated_at = utcnow()
    session.add(project)
    session.commit()

    # Update on Disk
    file_path = os.path.join(base_dir, filename)

    # Ensure directory exists
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(data.content)

    if is_untrusted_code_execution_enabled():
        # Trigger dev server
        from devserver import dev_server_manager

        critical_files = [
            "package.json",
            "vite.config.ts",
            "tsconfig.json",
            "tailwind.config.js",
            "postcss.config.js",
        ]
        if filename in critical_files:
            # For manual edits, we might not want to restart immediately but let's follow the requirement
            await dev_server_manager.restart(project_id, base_dir)
        else:
            await dev_server_manager.start(project_id, base_dir)

        asyncio.create_task(run_project_autofix(project_id, user_id=request_user_id))

    return {"ok": True}

@router.get("/{project_id}/export")
def export_project(
    project_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    session: Session = Depends(get_session),
):
    project = require_project_for_user(session, project_id, get_request_user_id(request))

    base_dir = os.path.abspath(f"./generated/{project_id}")
    if not os.path.exists(base_dir):
        # Fallback if folder missing (e.g. old project): recreate it from DB files
        os.makedirs(base_dir, exist_ok=True)
        files = session.exec(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        ).all()
        for file in files:
            if not is_safe_path(base_dir, file.filename):
                continue
            path = os.path.join(base_dir, file.filename)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(file.content)

    # Create zip file
    zip_filename = f"{project.name.replace(' ', '_')}_{project_id[:8]}.zip"
    zip_path = os.path.join(os.path.dirname(base_dir), zip_filename)

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(base_dir):
            for file in files:
                # Don't include node_modules or dist/build artifacts
                if "node_modules" in root or ".git" in root or "dist" in root:
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, base_dir)
                zipf.write(file_path, arcname)

    # Schedule cleanup of the zip file after sending
    background_tasks.add_task(os.remove, zip_path)

    headers = {
        "Content-Disposition": f'attachment; filename="{zip_filename}"',
        "Accept-Ranges": "none",
    }

    def stream_zip():
        with open(zip_path, "rb") as file_obj:
            while True:
                chunk = file_obj.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        stream_zip(),
        media_type="application/zip",
        headers=headers,
        background=background_tasks,
    )
