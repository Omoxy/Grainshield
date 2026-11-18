# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.22.1-alpine3.19 AS builder

WORKDIR /build

# Copy shared pkg module first (required by replace directive)
COPY pkg/ /pkg/

# Copy dependency files for layer caching
COPY services/farmer-service/go.mod services/farmer-service/go.sum ./
RUN go mod download

# Copy source code
COPY services/farmer-service/ .

# Build static binary
ARG TARGETARCH=arm64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build \
    -ldflags="-w -s -X main.version=1.0.0" \
    -trimpath \
    -o farmer-service .

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

LABEL maintainer="GrainShield Engineering"
LABEL service="farmer-service"
LABEL version="1.0.0"

COPY --from=builder /build/farmer-service /farmer-service
COPY --from=builder /build/migrations /migrations

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/farmer-service"]
