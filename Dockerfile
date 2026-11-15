# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini su-exec

ARG RAINLOG_VERSION=dev
ENV NODE_ENV=production \
    RAINLOG_HOST=0.0.0.0 \
    RAINLOG_PORT=8080 \
    RAINLOG_DATA_DIR=/data \
    RAINLOG_WEB_DIR=/app/web/dist \
    RAINLOG_VERSION=${RAINLOG_VERSION}

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /usr/local/bin/rainlog-entrypoint
RUN chmod 755 /usr/local/bin/rainlog-entrypoint \
    && mkdir -p /data \
    && chown node:node /data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/rainlog-entrypoint"]
CMD ["node", "server/dist/server.js"]
