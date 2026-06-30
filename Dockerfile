# VSHORT worker — Node 22 + FFmpeg. Builds the React SPA and serves it together
# with the REST API as a single service. Data + assets live in Supabase, so this
# container is stateless (safe to restart/scale).

# ── Stage 1: build the SPA ──────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Stage 2: runtime (server + ffmpeg + built SPA) ──────────────────
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Server deps (root package.json) — production only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code + the built SPA from stage 1.
COPY server/ ./server/
COPY public/ ./public/
COPY --from=web /web/dist ./web/dist

ENV NODE_ENV=production
# Railway/Render inject PORT; the server reads process.env.PORT (default 3000).
EXPOSE 3000
CMD ["node", "server/index.js"]
