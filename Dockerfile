FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY . .
# Optional build-only trust for managed environments; never copied into the image.
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  bun install --frozen-lockfile
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  NUXT_TYPECHECK=false bun run build \
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
# The non-root migrator must read history even from a restrictive checkout.
COPY --from=build --chown=node:node /app/server/database/migrations ./server/database/migrations
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
