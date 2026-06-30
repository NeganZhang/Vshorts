# VSHORT — Deploy (cloud)

One **Railway** service (Docker + FFmpeg) runs the Node worker AND serves the built
React SPA. **Supabase** holds auth + Postgres + Storage. The container is stateless
(all data/assets in Supabase), so it can restart/scale freely.

```
Browser ──> Railway service (Dockerfile: Node 22 + ffmpeg)
              • serves the SPA (web/dist)
              • REST API (/api) + agent
              • runs Gemini (images) + Seedance (video) + ffmpeg
            └──> Supabase (auth, Postgres, Storage)
```

## Prerequisites
1. **Supabase** project with `schema.sql` + `supabase/migrations/0002_templates_storage.sql` already run (done).
2. Code pushed to GitHub (branch `vshort-v2-supabase-spa` or merged to `main`).
3. Keys ready: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and (for real media) `GEMINI_API_KEY`, `ARK_API_KEY`.

## Deploy on Railway
1. https://railway.app → **New Project → Deploy from GitHub repo** → pick this repo + branch.
2. Railway detects the **Dockerfile** and builds it (Node 22 + ffmpeg, builds the SPA).
3. **Variables** tab — set:
   ```
   NODE_ENV=production
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role / sb_secret_…>
   ANTHROPIC_API_KEY=<sk-ant-…>
   GEMINI_API_KEY=<…>            # optional; enables real storyboard images
   ARK_API_KEY=<…>              # optional; enables real Seedance video
   ARK_VIDEO_MODEL=doubao-seedance-2-0-260128
   ARK_VIDEO_RESOLUTION=720p
   MAX_RENDER_SCENES=8
   MAX_TOTAL_SECONDS=80
   ```
   **Do NOT set** `HTTPS_PROXY` (Railway is outside China — Anthropic/Gemini work direct).
   **Do NOT set** `LOCAL_DEV_USER_ID`, `FFMPEG`, `FFPROBE` (ffmpeg is on PATH in the image).
4. **Networking → Generate Domain.** Railway injects `PORT`; the server reads it.
5. Open the domain → **sign up** (email/password) → make a video.

> SPA build-time envs (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) default to the
> correct public Supabase values and `VITE_API_BASE` is empty (same-origin), so no
> build args are needed. Override only if you change Supabase projects.

## Supabase auth config
- Auth → Providers → Email: enable. If "Confirm email" is ON, users must verify before login
  (or turn it off for a frictionless MVP).
- Auth → URL Configuration → add your Railway domain to the allowed redirect/site URLs.

## Notes / sizing
- FFmpeg + Seedance rendering is CPU/RAM heavy and takes minutes per video. The free/starter
  instance works for testing; bump the plan for real load. Renders run in-process; one job at a
  time per project (the 409 guard prevents double-billing).
- Render concurrency across scenes: `ARK_RENDER_CONCURRENCY` (default 1).
- Cost caps are enforced server-side: `MAX_RENDER_SCENES`, `MAX_TOTAL_SECONDS`.

## Alternative: SPA on Vercel + worker on Railway (two services)
Only needed if you want the SPA on a CDN. Build `web/` on Vercel, set `VITE_API_BASE` to the
Railway URL, and set `ALLOWED_ORIGINS` on the worker to the Vercel domain (CORS). The
single-service setup above is simpler and recommended to start.
