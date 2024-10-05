FROM golang:1.21.13-alpine AS builder
ADD --link https://github.com/isker/ecs_exporter.git#use-official-types /app
RUN CGO_ENABLED=0 go build -C /app -o /bin/ecs_exporter

FROM gcr.io/distroless/static
COPY --link --from=builder /bin/ecs_exporter /bin/
ENTRYPOINT ["ecs_exporter"]
