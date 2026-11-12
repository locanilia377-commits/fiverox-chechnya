FROM node:24-bookworm-slim AS dependencies
RUN npm install --global pnpm@11.25.0
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production DATABASE_ENGINE=pg HOST=0.0.0.0 PORT=8080 PUBLIC_DIR=/app/site
WORKDIR /app/server
COPY --from=dependencies /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY site /app/site
USER node
EXPOSE 8080
CMD ["node", "src/index.mjs"]
