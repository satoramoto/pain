# The engine as one image for an NVIDIA GPU with no container runtime to ask: a rented
# machine, a CI job. It is llama.cpp's CUDA server with this checkout's launcher and presets;
# `ai serve` fetches the model, then becomes llama-server.
#
#   docker build -f containers/engine-cuda/Dockerfile -t pain-engine-cuda .
#   docker run --gpus all -p 11434:11434 -v ~/Models:/models \
#     -e PAIN_API_KEY -e PAIN_MODEL=owner/repo:file.gguf pain-engine-cuda
#
# PAIN_MODEL is a preset (./ai presets) or a GGUF source as for `ai pull`. The server listens
# beyond localhost here, so it refuses to start without PAIN_API_KEY. HF_TOKEN reaches gated
# repositories; PAIN_ENGINE_ARGS adds llama-server options.
ARG LLAMACPP_IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda
FROM ${LLAMACPP_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY ai comfy_backend.py /opt/pain/
COPY models /opt/pain/models
ENV PAIN_MODELS_DIR=/models PAIN_HOST=0.0.0.0 PAIN_PORT=11434
VOLUME /models
EXPOSE 11434
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m \
    CMD curl -fsS "http://127.0.0.1:${PAIN_PORT}/health" || exit 1
ENTRYPOINT ["python3", "/opt/pain/ai", "serve"]
