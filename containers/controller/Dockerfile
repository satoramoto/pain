FROM docker.io/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 podman podman-compose ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
ENV PODMAN_COMPOSE_PROVIDER=/usr/bin/podman-compose
ENTRYPOINT ["python3"]
