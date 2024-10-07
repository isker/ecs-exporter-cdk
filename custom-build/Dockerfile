FROM golang:1.21.13-alpine AS builder
ARG SOURCE=https://github.com/prometheus-community/ecs_exporter.git
ADD --link $SOURCE /app
RUN --mount=type=cache,target="/root/.cache/go-build" --mount=type=cache,target="/go/pkg/mod" CGO_ENABLED=0 go build -C /app -o /bin/ecs_exporter

FROM gcr.io/distroless/static
COPY --link --from=builder /bin/ecs_exporter /bin/
ENTRYPOINT ["ecs_exporter"]
