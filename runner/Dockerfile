# Build stage
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Run stage
FROM node:22-alpine AS run
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Audit log location — mount a volume here in production
VOLUME ["/app/logs"]

ENV AUDIT_PATH=/app/logs/audit.jsonl

RUN addgroup -S runner && adduser -S runner -G runner && chown -R runner:runner /app
USER runner

CMD ["node", "dist/index.js"]
