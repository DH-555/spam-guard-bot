FROM node:22-alpine AS dependencies

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM dependencies AS manifests

COPY src ./src
COPY scripts ./scripts
COPY visual-references ./visual-references
COPY easter-egg\ photos ./easter-egg\ photos
RUN pnpm build:visual-references
RUN pnpm build:easter-egg-photos

FROM node:22-alpine AS runtime

ENV NODE_ENV="production"
ENV OCR_CACHE_PATH="/app/tessdata"

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=manifests /app/generated ./generated
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data /app/tessdata \
  && chown -R node:node /app

USER node

CMD ["node", "src/index.js"]
