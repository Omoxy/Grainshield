FROM golang:1.22.1-alpine3.19 AS builder
WORKDIR /build
COPY pkg/ /pkg/
COPY services/ussd-service/go.mod services/ussd-service/go.sum ./
RUN go mod download
COPY services/ussd-service/ .
ARG TARGETARCH=arm64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build \
    -ldflags="-w -s" \
    -trimpath \
    -o ussd-service .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL maintainer="GrainShield Engineering"
LABEL service="ussd-service"
COPY --from=builder /build/ussd-service /ussd-service
USER 65532:65532
EXPOSE 8087
ENTRYPOINT ["/ussd-service"]
