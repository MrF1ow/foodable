FROM oven/bun:1.4.4 AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run gen:all
USER bun
EXPOSE 8080
CMD ["bun", "--smol", "src/index.ts"]
