# Apple Silicon Metal container test

This is an experimental integration, not the all-in-one end-user release.
The Linux ARM64 llama-server runs in Podman. Its VirtGPU backend forwards
operations to the real ggml-metal backend in the Mac virtualization process.
It does not run the macOS llama-server executable in Linux, and does not use
Vulkan/MoltenVK. Python and the PAIN controller also run in a container.

The current upstream backend requires APIR-enabled virglrenderer. Merely
installing stock Podman or selecting libkrun does **not** establish this support.

## What lives where

- Mac: Podman/libkrun, APIR-enabled virglrenderer, matching Metal/remoting
  libraries, this checkout and model storage. No system-wide Python or inference
  service is required by the launcher.
- VM: container engine and its Compose provider (controller image includes it).
- Containers: Python controller and Linux llama-server with VirtGPU.
- The controller has the Podman socket so it can manage sibling engine containers.
  Use a dedicated PAIN machine, not one containing unrelated workloads.
- No Tauri bundle or Storybook renderer is included in this backend test.

## Prepare the virtualization stack (developer Mac)

Use an Apple Silicon Mac with Podman and libkrun/krunkit installed. Upstream
lists macOS 14/15 as supported and 26 as untested. We still need to test our
exact combination. Record macOS version, chip, memory, Podman and krunkit versions.

Build the host libraries from the **same pinned llama.cpp commit** as the guest:

```sh
./integrations/macos/build-metal-libraries
```

This developer-only step needs Git, CMake and Apple command-line build tools.
It installs nothing globally; output stays under `.build/`. A distributable
virtualization package must eventually include these libraries and their
runtime dependencies so the recipient does not need build tools.

Build APIR-enabled virglrenderer using the upstream development instructions:
<https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/VirtGPU/development.md>
The documented Mac branch is:
<https://gitlab.freedesktop.org/kpouget/virglrenderer/-/tree/main-macos>
Record its exact revision for the test. This dependency is not yet pinned or
bundled by PAIN; integration of that virtualization package remains a release gate.
Do not overwrite system/Homebrew libraries to make it work.

Create a **new dedicated machine**; don't replace an existing machine:

```sh
CONTAINERS_MACHINE_PROVIDER=libkrun podman machine init --cpus 4 --memory 8192 --disk-size 60 pain-metal
export PAIN_METAL_LIB_DIR="$PWD/.build/metal-$(cat containers/virtgpu/llama-revision)/build/bin"
export PAIN_VIRGL_LIB_DIR="/absolute/path/to/virglrenderer/build/src"
./integrations/macos/start-machine
```

Run the start script from a local Mac terminal. Upstream documents limitations
with DYLD_LIBRARY_PATH when launched over SSH. The script configures the legacy
Venus-to-APIR routing workaround, which disables ordinary Vulkan forwarding in
this VM. Stop only this dedicated machine before restarting it with changed
libraries. A running machine won't pick up new host environment variables.

Keep the checkout and models under your Mac home directory so Podman's default
host sharing exposes both at the same absolute paths in the VM. Memory above is
an initial small-model test allocation, not a recommendation for your large
presets. Upstream documents a 64 GiB RAM+VRAM addressable limit for libkrun;
verify the current limit on the actual stack before testing large models.

## Run without host Python

```sh
export PAIN_MODELS_DIR="$HOME/Models"
./integrations/macos/ai presets
./integrations/macos/ai config llamacpp-metal
./integrations/macos/ai up llamacpp-metal
./integrations/macos/ai status
./integrations/macos/ai logs
./integrations/macos/ai down
```

The launcher selects the `pain-metal` Podman connection explicitly. Override
`PAIN_PODMAN_CONNECTION` if Podman named the connection differently. It does not
change the global default or start/stop the VM implicitly. First invocation
builds the Python/Podman controller image; `up llamacpp-metal` builds the pinned
llama.cpp image. To refresh controller dependencies, rebuild with:

```sh
podman --connection pain-metal build -t localhost/pain-controller:dev containers/controller
```

The Metal probe enumerates actual devices before replacing an engine. It refuses
CPU-only, plain Vulkan and native-only Metal enumeration. Startup also pins the
enumerated remoted Metal device. Successful API readiness alone is not evidence
of full model offload: inspect model-load logs and run a generation request.

Use an existing preset only when its GGUF fits comfortably in memory. For an
initial small test, put a supported GGUF in `PAIN_MODELS_DIR` and create
`models/mac-smoke/default.Modelfile` locally with `FROM /models/<filename>.gguf`
and `PARAMETER num_ctx 4096`. `./integrations/macos/ai pull <GGUF-URL>` can download
it without host Python. Model weights are never included in the application image.
After startup, request `/v1/chat/completions` on localhost:11434 with the preset
name `mac-smoke-default`. Remove only your temporary preset when done.

The existing `ai run` and `ai bench` are Ollama-specific; use the OpenAI-compatible
API for this backend. Linux hardware telemetry in paintop describes VM resources
when run in the controller, not the Mac's physical RAM/GPU. Mac telemetry and
tray UI are still separate work.

## Acceptance checks on the Mac

1. Confirm `lsof -c krunkit` shows the intended virglrenderer and Metal libraries.
2. Check the image architecture is ARM64; no x86 emulation should be needed.
3. With the APIR libraries unavailable, verify startup fails clearly and does not
   replace a previously running PAIN engine.
4. With the correct stack, require a remoted Metal device in the startup probe,
   successful model loading, offload evidence in logs, and a completed generation.
5. Exercise status, logs, stop, restart, and model persistence across VM restart.
6. Record prompt/generation speed and memory with a small model before trying
   large Q8, long-context or speculative-decoding presets. Those features are
   not validated on this stack yet.

## Validation before handing off

Run the Python unit suite, render every Compose backend, check shell syntax,
build the Linux VirtGPU and controller images, and verify the missing-GPU
failure path. The Linux build checks cannot establish macOS Metal correctness.
Mac acceptance above is required before calling this shippable.
