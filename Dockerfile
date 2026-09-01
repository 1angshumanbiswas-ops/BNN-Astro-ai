# BNN_ASTRO_AI backend — built for Render (Docker runtime), same pattern as
# this account's gemstones_ai app: push to GitHub, Render auto-deploys on
# push to main. Only the backend/ directory is containerized — public/ is
# static Firebase Hosting content and never enters this image.

FROM node:20-slim AS builder
WORKDIR /app

# Copy only the manifest first so Docker's layer cache can skip a fresh
# `npm ci` when only application code changes, not dependencies.
COPY backend/package.json backend/package-lock.json ./
# --no-audit/--no-fund trim extra network calls during install; the retry
# guards against a known flaky npm 10.x "Exit handler never called!" error
# under any transient network hiccup (hit and confirmed harmless-but-real
# during this build's own verification — see README).
RUN npm ci --omit=dev --no-audit --no-fund \
    || npm ci --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY backend/ ./

# Render sets PORT itself and expects the container to listen on it;
# index.js already reads process.env.PORT (falls back to 8080 locally).
EXPOSE 8080

CMD ["node", "index.js"]
