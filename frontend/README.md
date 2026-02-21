# Lovable Local Frontend

React 19 + TypeScript + Vite client for Lovable Local.

## What This App Includes

- Landing page and authenticated dashboard
- AI builder workspace with chat, live preview, code editor, and terminal
- Settings for Ollama/model/provider/routing configuration

## Local Development

```bash
cd frontend
npm install
# copy .env.example -> .env.local and fill values
npm run dev
```

Default dev URL: `http://localhost:5173`

## Production Checks

```bash
npm run lint
npm run build
```

## Required Environment Variables

Set these when running locally or on your hosting provider:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_BACKEND_URL` (example: `https://api.yourdomain.com`)
- `VITE_WS_URL` (optional, inferred from `VITE_BACKEND_URL` if omitted)

## Deploy (Frontend)

This frontend can deploy as a static SPA (Vercel, Netlify, Cloudflare Pages, etc.).

1. Build command: `npm run build`
2. Output directory: `dist`
3. Configure environment variables listed above.
4. Ensure backend CORS allows your frontend origin.

## Notes

- Clerk auth is required at runtime (missing key will stop app startup).
- Builder features depend on the FastAPI backend and websocket endpoints.
- Security headers + CSP are enforced in:
  - `nginx.conf` (Docker/runtime)
  - `vite.config.ts` (local dev server/preview)
  - `vercel.json` (Vercel deploys)
