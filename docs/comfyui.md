# ComfyUI on Linux

PAIN can replace its LLM container with ComfyUI, and switch back without deleting
models or images. ComfyUI is offered on Linux only; macOS has no ComfyUI backend.

```sh
./ai up comfyui                  # Detect AMD or NVIDIA
./ai up comfyui --device rocm    # Choose AMD on a mixed-vendor machine
./ai up comfyui --device cuda    # Choose NVIDIA on a mixed-vendor machine
./ai status
./ai logs
./ai down
./ai up llamacpp-vulkan          # Return to the LLM
```

Use sudo if your Docker installation requires it. PAIN does not change Docker
permissions. Set configuration in the checkout's `.env` when using sudo.
The browser interface is at <http://127.0.0.1:8188>. `PAIN_COMFYUI_PORT` changes
only ComfyUI's host port; `PAIN_PORT` still belongs to LLMs. No browser opens
automatically. `./ai config comfyui-rocm` and `./ai config comfyui-cuda` render
either configuration without starting a container or needing that GPU locally.

## GPU selection and image support

PAIN reads GPU PCI vendor IDs, including NVIDIA devices without DRM KMS. With one
supported vendor it selects the matching backend. If both vendors are present,
it asks for `--device rocm` or `--device cuda`. It does not silently fall back to
CPU. An explicit choice still needs the selected vendor's GPU and working driver.

Images come from the community project
[romkey/comfyui-docker](https://github.com/romkey/comfyui-docker), not Comfy Org or
AMD. The default build tag is `0.45.0-20261111064008`, with:

| Backend | Image suffix | Host requirements |
| --- | --- | --- |
| `comfyui-rocm` | `-rocm-gfx1151` | AMD Strix Halo, amdgpu, `/dev/kfd` and `/dev/dri/renderD*` |
| `comfyui-cuda` | `-cu128` | NVIDIA GPU supported by that PyTorch build, compatible driver (upstream specifies 570+), NVIDIA Container Toolkit configured for Docker |

**The default AMD image is for Strix Halo (PCI device 1002:1586), including the
8060S in PAIN's Z13. Vendor detection is not a claim that every AMD GPU supports
ROCm.** Other AMD GPUs require `PAIN_COMFYUI_ROCM_IMAGE` pointing to a compatible
image. PAIN refuses to launch the Strix Halo default on another AMD architecture.
Upstream documents building for other AMD wheel indexes; preserve its entrypoint
and `/data` layout, and remove Strix-specific ISA overrides when building for a
different GPU. Publish the resulting image to a registry accessible to Docker.

`PAIN_COMFYUI_CUDA_IMAGE` overrides the NVIDIA image. Both accept digests for
immutable pinning. Overrides must follow the same image contract: `python` on
PATH, the upstream entrypoint/environment settings, ComfyUI on port 8188,
`/system_stats`, and persistent state under `/data`.

Before replacing the existing service PAIN validates Compose, pulls the image,
and runs a temporary container that checks the PyTorch backend and executes a
small GPU matrix multiplication. A missing NVIDIA Container Toolkit, bad GPU
driver, incompatible image, or failed probe leaves the current engine intact.
After replacement it waits up to 180 seconds for ComfyUI's `/system_stats` to
report a GPU. A later startup failure is reported and the selected backend is
kept in state so `logs` and `down` still work. This is not automatic rollback.

The container gets the required GPU access, not privileged mode. The AMD image
handles render/video group ownership. Both variants share one Compose project,
service identity and container name (`pain-engine`), so switching interrupts
active requests and unloads the preceding engine.

## Persistent workspace

`PAIN_COMFYUI_DATA_DIR` defaults to `~/.local/share/pain/comfyui`, including when
invoked through sudo (the invoking user's home and UID/GID are used). It must be
an absolute path. The image prepares these folders under the bind mount:

- `models/`: ComfyUI's diffusion_models, text_encoders, vae, loras and other folders.
- `input/` and `output/`: source and generated images.
- `user/`: settings and saved workflows.
- `custom_nodes/`: installed node source.
- `cache/`: model-download and GPU kernel caches.

Stopping, switching and recreating the container do not delete this workspace.
It is independent of Ollama's volume and the LLM hot/cold model folders. To reuse
existing weights, put them in the appropriate ComfyUI subfolder or configure
additional mounts explicitly; PAIN does not copy weights automatically.

Manager is enabled, but the image's unrelated bundled custom nodes are disabled.
Custom-node requirements are reinstalled at startup so recreating the container
does not leave persisted node source without its Python dependencies. This can
need network access and take longer on the first start. Failed node installs
appear in `./ai logs`; server readiness is not proof that every custom node works.
Use `PAIN_COMFYUI_ARGS` for additional ComfyUI flags; do not override its port,
listen address or base directory because PAIN relies on those settings.

LLM commands (`run`, `pull`, `apply`, `bench`, `sync`, `top`) report that ComfyUI is
active rather than sending Ollama requests to it. Use the browser to manage image
models and jobs; switch back to use the LLM commands.

## H3-Image

ComfyUI 0.45.0 includes native MiniMax H3-Image support. In Templates, choose
**MiniMax H3 Image** text-to-image or image-edit, then obtain the diffusion model,
Qwen3-VL text encoder, and image VAE named by that workflow. No weights are
downloaded by `ai up`. Read the
[official H3-Image announcement](https://blog.comfy.org/p/minimax-h3-image-is-now-available)
for workflow details. GPU availability does not establish that a particular
checkpoint, precision or resolution fits in memory.

## Validation and scope

Before merging: run `python -m unittest discover -s tests -v`; render the two
ComfyUI Compose configurations and the existing ROCm/Vulkan/llama.cpp configurations;
confirm that the pinned container tags have published manifests; check the diff.
Review: **look**. The implementation checks selection, GPU preflight ordering,
failure state, persistence mounts, CLI routing and readiness with fake GPU/API
fixtures. It is not an image-generation benchmark.

Hardware acceptance: on the Z13, start `./ai up comfyui`, confirm ROCm and the
8060S in logs, generate using a locally available model, save a workflow, switch
back to an LLM and then ComfyUI, and confirm the saved output/workflow remains.
Repeat on an NVIDIA machine with Container Toolkit. Live GPU acceptance requires
Docker daemon permission and locally available model weights; report it separately
from the automated checks.

This change starts from `main`, which has no desktop picker or OpenSpec directory.
The concurrent Mac/desktop branch is not edited. When that branch incorporates
this backend, its picker must use the same Linux-only availability rule and
ComfyUI-specific status API rather than treating ComfyUI as an LLM.
