FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run postinstall \
  && NUXT_TYPECHECK=false bun run build \
  && mkdir -p .migration .jobs \
  && bun build ./scripts/migrate.ts --target=node --outfile .migration/migrate.mjs \
  && bun build ./scripts/jobs-migrate.ts --target=node --outfile .jobs/migrate.mjs \
  && bun build ./scripts/jobs-doctor.ts --target=node --outfile .jobs/doctor.mjs \
  && bun build ./scripts/jobs-worker.ts --target=node --outfile .jobs/worker.mjs \
  && bun build ./scripts/jobs-smoke.ts --target=node --outfile .jobs/smoke.mjs
FROM node:24-alpine AS runtime
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/.migration ./.migration
COPY --from=build /app/.jobs ./.jobs
COPY --from=build /app/server/database/migrations ./server/database/migrations
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
