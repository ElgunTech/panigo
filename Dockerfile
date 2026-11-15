# ---- Urban Crisis & Crowd Evacuation Engine — single-image deploy ----
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w client

ENV NODE_ENV=production \
    PORT=4000 \
    DB_FILE=/data/panigo.db
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["npx", "tsx", "server/src/index.ts"]
