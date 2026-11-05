FROM node:24-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=eru-server-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3001
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node sql ./sql
COPY --chown=node:node tools/community ./tools/community
COPY --chown=node:node docker/project-entrypoint.sh ./docker/project-entrypoint.sh
USER node
EXPOSE 3001
ENTRYPOINT ["sh", "/app/docker/project-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
