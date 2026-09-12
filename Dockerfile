# Image de production voxlivre-api (Railway build depuis ce Dockerfile).
# Multi-stage : deps → build → prod-deps → runner (image finale minimale,
# sans devDependencies ni sources TS).

FROM node:22.23-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# Node 22 LTS bundle corepack, qui lit `packageManager` dans package.json
# pour activer exactement pnpm@11.15.1 — source unique de vérité.
RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# --ignore-scripts : pas de husky/prepare dans un conteneur (pas de .git).
# Les devDeps sont installées ici car nécessaires au build.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY . .

RUN pnpm build

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.23-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Migrations SQL embarquées : `node dist/migrate` (à venir) les applique
# en pré-déploiement.
COPY --from=build --chown=node:node /app/src/shared/persistence/migrations ./migrations
COPY --chown=node:node package.json ./

EXPOSE 8080

USER node

CMD ["node", "dist/main"]
