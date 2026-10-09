# ---------- 1. Build do frontend (Vite + React) ----------
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2. Build do backend (Express + Prisma) ----------
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# ---------- 3. Imagem final ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=server-build /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=client-build /app/client/dist ./public
COPY server/docker-entrypoint.sh ./docker-entrypoint.sh

# Roda sem root: o usuário "node" (uid 1000) só precisa escrever em /app/data.
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
