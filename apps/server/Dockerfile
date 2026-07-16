FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
RUN pnpm --filter @agentflow/shared build && pnpm --filter @agentflow/server build

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "apps/server/dist/main.js"]
