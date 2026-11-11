FROM docker.io/library/debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git cmake ninja-build g++ pkg-config libdrm-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY llama-revision /revision
RUN git init /src && git -C /src remote add origin https://github.com/ggml-org/llama.cpp.git \
    && git -C /src fetch --depth 1 origin "$(cat /revision)" \
    && git -C /src checkout --detach FETCH_HEAD
RUN cmake -S /src -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF -DGGML_VIRTGPU=ON -DGGML_VIRTGPU_BACKEND=OFF \
    -DGGML_VULKAN=OFF -DGGML_METAL=OFF -DLLAMA_BUILD_TESTS=OFF \
    && cmake --build /build --target llama-server --parallel 4

FROM docker.io/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 libdrm2 libgomp1 libssl3t64 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/bin/ /opt/llama/
COPY llama-revision /opt/llama/revision
COPY entrypoint.py /opt/llama/entrypoint.py
ENV LD_LIBRARY_PATH=/opt/llama
ENTRYPOINT ["python3", "/opt/llama/entrypoint.py"]
