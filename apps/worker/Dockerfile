FROM node:26-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/gym/package.json apps/gym/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/worker apps/worker
COPY packages/domain packages/domain
COPY tsconfig.json ./
COPY scripts/run.mjs scripts/run.mjs
RUN mkdir -p /state && chown node:node /state
USER node
ENV WORKER_STATE_DIR=/state NODE_ENV=production
CMD ["npm","run","worker"]
