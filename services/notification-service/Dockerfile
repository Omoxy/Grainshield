FROM golang:1.22.1-alpine3.19 AS builder
WORKDIR /build
COPY pkg/ /pkg/
COPY services/notification-service/go.mod services/notification-service/go.sum ./
RUN go mod download
COPY services/notification-service/ .
ARG TARGETARCH=arm64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -ldflags="-w -s" -trimpath -o notification-service .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /build/notification-service /notification-service
COPY --from=builder /build/migrations /migrations
USER 65532:65532
EXPOSE 8086
ENTRYPOINT ["/notification-service"]
