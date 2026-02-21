# Repository Guidelines

## Project Structure & Module Organization
- `frontend/` contains the React 19 + TypeScript + Vite app.
- `frontend/src/pages` holds route-level screens; `frontend/src/components` holds reusable UI; `frontend/src/components/ui` contains shadcn-style primitives.
- `frontend/src/lib` contains API/socket helpers, `frontend/src/store` contains Zustand state, and `frontend/src/types` contains shared typings.
- `backend/` contains the FastAPI service. `backend/main.py` is the app entry point, and `backend/routes/*.py` groups endpoints by feature (`chat`, `projects`, `terminal`, etc.).
- Runtime data lives in `backend/data/`; generated app output goes to `backend/generated/`.
- Root-level infrastructure/config files include `docker-compose.yml` and `.env.example`.

## Build, Test, and Development Commands
- `docker-compose up --build`: starts Ollama, backend (`:8000`), and frontend (`:5173`) together.
- `cd backend && python -m venv venv && venv\Scripts\activate`: create and activate backend virtualenv (Windows).
- `cd backend && pip install -r requirements.txt`: install backend dependencies.
- `cd backend && uvicorn main:app --reload --port 8000`: run FastAPI locally.
- `cd frontend && npm install`: install frontend dependencies.
- `cd frontend && npm run dev`: start Vite dev server.
- `cd frontend && npm run lint`: run ESLint.
- `cd frontend && npm run build`: run TypeScript build (`tsc -b`) and production bundle.

## Coding Style & Naming Conventions
- Python: 4-space indentation, type hints for new/changed APIs, and `snake_case` for modules and functions.
- TypeScript/React: 2-space indentation, `PascalCase` for components/pages (example: `BuilderHeader.tsx`), and `useXxx` naming for hooks (example: `useConsoleMonitor.ts`).
- Keep backend route logic in `backend/routes` and shared frontend helpers in `frontend/src/lib`.
- Run `npm run lint` before opening a PR.

## Testing Guidelines
- No full automated test suite is configured yet (current smoke file: `backend/test_server.py`).
- Minimum validation before PR: `npm run lint`, `npm run build`, and manual checks for affected UI flows plus `GET /health`.
- For new tests, prefer `pytest` for backend endpoints and colocated frontend tests under `frontend/src/**/__tests__/`.

## Commit & Pull Request Guidelines
- `master` currently has no commit history; use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`) going forward.
- Keep commits scoped to one concern and use imperative subjects.
- PRs should include: summary, linked issue/ticket, verification steps (commands run), and screenshots/GIFs for UI changes.
- Call out any environment variable, schema, or behavior changes explicitly.
