# syntax=docker/dockerfile:1
FROM node:24-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app

# Couche dépendances: reconstruite uniquement si package*.json change.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

COPY src ./src

# Données (SQLite, médias, sauvegardes): volume monté, propriétaire fixé au runtime via `user:` du compose.
VOLUME /app/data
CMD ["node", "src/index.js"]
