# Image de production voxlivre-api, déployée sur AWS (ADR-0012) : EC2 en
# phase 1, ECS Fargate en vitrine — même image, construite pour arm64 (Graviton).
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
# Caches BuildKit partagés avec prod-deps, conservés entre deux builds :
#   - `/pnpm/store` : les paquets (`$PNPM_HOME/store`) ;
#   - `/root/.cache` : pnpm lui-même (téléchargé par corepack) et les
#     métadonnées du registre, que pnpm 11 relit pour chaque paquet
#     (vérification supply-chain du lockfile).
# Chaque fichier n'est téléchargé qu'une fois ; une relance après une
# coupure réseau repart du cache.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY . .

# Même cache : corepack y a rangé pnpm à l'étape deps.
RUN --mount=type=cache,id=pnpm-cache,target=/root/.cache pnpm build

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache \
    pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.23-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Migrations SQL embarquées : `node dist/migrate` les applique en
# pré-déploiement (dossier par défaut : `/app/migrations`).
COPY --from=build --chown=node:node /app/src/shared/persistence/migrations ./migrations
COPY --chown=node:node package.json ./

EXPOSE 8080

USER node

CMD ["node", "dist/main"]
