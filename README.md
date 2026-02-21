# Lovable Local — AI App Builder

A local-first AI app builder powered by Ollama. Describe your app in plain English, get React + TypeScript + TailwindCSS code generated live. Now with an integrated terminal and project management tools.

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
   - On the backend, set `CORS_ORIGINS` to include your Vercel frontend URL.
2. In Vercel project env vars, set:
   - `VITE_CLERK_PUBLISHABLE_KEY`
   - `VITE_BACKEND_URL` (example: `https://your-backend.example.com`)
   - `VITE_WS_URL` (optional; defaults from `VITE_BACKEND_URL`)
3. Deploy preview:

```bash
vercel deploy frontend -y
```

## Secure BYOK + Local Ollama

The backend now supports both:

- Local open-source models through Ollama (default when no external provider is selected).
- BYOK external providers (OpenAI-compatible) with encrypted key storage.

For external providers, set:

- `BYOK_ENCRYPTION_KEY` (required; either a Fernet key or a strong passphrase)

For hosted/authenticated deployments:

- `ENABLE_UNTRUSTED_CODE_EXECUTION` defaults to `false` when `CLERK_SECRET_KEY` is configured.
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

- **Chat-Driven Development**: Describe your app in natural language.
- **Live Preview**: See your changes in real-time with Sandpack.
- **Integrated Terminal**: Run commands (`npm install`, `npm run dev`) directly from the UI.
- **Model Manager**: Pull and manage Ollama models from the Settings page.
- **Auto-Titling**: Projects are automatically named based on your first prompt.
- **100% Local**: Powered by Ollama, no data leaves your machine.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, shadcn/ui, Monaco Editor, Sandpack
- **Backend**: FastAPI, SQLite, SQLModel
- **AI**: Ollama (local LLM)
# lovable
