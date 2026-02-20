# --- Stage 1: Build Frontend (React/Vite) ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build Backend (Go) ---
FROM golang:1.25.7-alpine AS backend-builder
RUN apk add --no-cache git
WORKDIR /app

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Secure: Copy built frontend to the internal folder for embedding
# We remove any existing content and replace it with the new build
RUN rm -rf internal/api/frontend_dist && mkdir -p internal/api/frontend_dist
COPY --from=frontend-builder /app/frontend/dist/ internal/api/frontend_dist/

# Build the OzyBase binary
# CGO_ENABLED=0 ensures a static binary for portability
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o ozybase ./cmd/ozybase

# --- Stage 3: Final Production Image ---
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata wget

RUN addgroup -S ozybase && adduser -S -G ozybase ozybase

WORKDIR /app

# Copy the binary from the builder
COPY --from=backend-builder /app/ozybase .

# Default environment variables
ENV PORT=8090
ENV DEBUG=false
ENV OZY_STORAGE_PROVIDER=local
ENV OZY_STORAGE_PATH=/app/data/storage

# Create necessary directories
RUN mkdir -p /app/data/storage /app/migrations /app/functions && \
    chown -R ozybase:ozybase /app

# Expose the API port
EXPOSE 8090

# Persistence: Mark data directories as volumes
VOLUME ["/app/data", "/app/migrations", "/app/functions"]

USER ozybase

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health >/dev/null || exit 1

# Run OzyBase
CMD ["./ozybase"]
