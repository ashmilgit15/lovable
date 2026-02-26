# OneForge — AI Application Studio

A local-first AI application studio powered by Ollama and BYOK providers. Describe your app in plain English, get production-ready React + TypeScript + TailwindCSS code generated live with real-time preview, integrated terminal, and deployment-ready output.

## Quick Start

```bash
# Prerequisites: Docker + Ollama running locally
docker-compose up
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- Ollama: http://localhost:11434

## Dev Setup (without Docker)

### Backend
```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Vercel Deployment (Frontend)

The Vite frontend is ready for Vercel deploys from `frontend/`.

1. Deploy a backend separately (FastAPI + WebSockets + local process features are not suitable for Vercel serverless in this repo).
   - On the backend, set `CORS_ORIGINS` to include your Vercel frontend URL (no trailing slash), for example:
     - `CORS_ORIGINS=https://oneforge.vercel.app`
   - Optional for preview deployments:
     - `CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app`
2. In Vercel project env vars, set:
   - `VITE_CLERK_PUBLISHABLE_KEY`
   - `VITE_BACKEND_URL` (example: `https://your-backend.example.com`)
   - `VITE_WS_URL` (optional; defaults from `VITE_BACKEND_URL`)
3. Deploy preview:

```bash
vercel deploy frontend -y
```

## Secure BYOK + Local Ollama

The backend supports both:

- Local open-source models through Ollama (default when no external provider is selected).
- BYOK external providers (OpenAI-compatible) with encrypted key storage.

For external providers, set:

- `BYOK_ENCRYPTION_KEY` (required; either a Fernet key or a strong passphrase)

For hosted/authenticated deployments:

- `ENABLE_UNTRUSTED_CODE_EXECUTION` defaults to `false` for all environments.
- Set it to `true` only in trusted/sandboxed environments if you need remote terminal/devserver/typecheck execution.

## Development Prep

1. Copy root env template and set local values:
   - `cp .env.example .env` (or create `.env` manually on Windows)
2. Set a BYOK encryption key for provider testing:
   - `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   - put the output in `BYOK_ENCRYPTION_KEY` in `.env`
3. Start local stack:
   - `docker-compose up --build`
4. Frontend dev checks:
   - `cd frontend && npm run lint`
5. Backend dev checks:
   - `cd backend && venv\\Scripts\\python.exe -m pytest -q`

## Features

- **AI Pair Programmer**: Chat with your codebase in natural language with full project context awareness.
- **Live Preview**: See every change rendered in real-time with Sandpack.
- **Integrated Terminal**: Run npm scripts, install packages, and execute commands directly in your browser.
- **Monaco Code Editor**: Full-featured in-browser code editing with syntax highlighting and version history.
- **Template Gallery**: 10+ professionally crafted templates for SaaS dashboards, e-commerce, portfolios, and more.
- **BYOK & Privacy-First**: Bring your own API keys with encrypted storage, or use local Ollama models.
- **Model Manager**: Pull and manage Ollama models from the Settings page.
- **Auto-Titling**: Projects are automatically named based on your first prompt.
- **Collaboration**: Real-time collaboration with WebSocket-based syncing.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, shadcn/ui, Monaco Editor, Sandpack
- **Backend**: FastAPI, SQLite, SQLModel
- **AI**: Ollama (local LLM) + BYOK providers (OpenAI-compatible)
