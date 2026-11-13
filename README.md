# pain(less)

**Making agentic coding with local AI as painless as possible**

Manage local inference engines and models from one small desktop panel, then
connect your coding agents to them. The project also includes runtime presets
and repeatable experiments.
Built initially for a 64 GB ASUS ROG Flow Z13 with a Ryzen AI Max+ 395 / Radeon
8060S on Linux. Currently serves one localhost-only inference engine at a time.

The display name is **pain(less)**. The repository, commands, `PAIN_*` environment
variables, application ID, and existing data directories keep their names for compatibility.

## Quick start

Linux requirements: Python 3.10+, Docker or Podman with a Compose provider,
and a working host AMD GPU driver for the GPU backends. Python uses only its standard library. ROCm needs `/dev/kfd`
and `/dev/dri`; Vulkan needs `/dev/dri`.

```sh
cd ~/Projects/satoramoto/pain
cp .env.example .env
./ai up rocm
opencode
```

Every `ai up` waits for the engine, then prepares the checked-in presets (applied
on Ollama backends, compiled into `models.ini` for llama.cpp). OpenCode V2
discovers them through the localhost inference API; select one with
`/models`. OpenCode runs on the host as your normal user, even if you start pain(less)
with sudo. You can also use `./ai run qwen38-q8-tuned` for Ollama's own chat.
New Modelfiles are picked up automatically on the next `ai up`.

If Docker requires sudo, use `sudo ./ai ...` for the commands above. The launcher
does not change your Docker permissions. Use the repo's `.env` for configuration
when running with sudo, since sudo may strip shell environment variables.

### Model storage

All weights live under `PAIN_MODELS_DIR` (default `~/Models`), mounted at
`/models` in the container. The Ollama backends keep their blob store in
`$PAIN_MODELS_DIR/ollama`, so pain(less) uses no custom Docker volumes. Presets
reference GGUFs directly by path.

If an older Ollama container owns port 11434, stop it before the first start:

```sh
sudo docker stop ollama
sudo ./ai up rocm
```

pain(less) does not stop containers it doesn't own. Nothing is downloaded or started
just by cloning this repo. For a fresh installation, download the model's GGUF
into `PAIN_MODELS_DIR` (for example `Qwen3.8-27B-Q8_0.gguf` from the model card
below), then start a backend.

### Downloads

`./ai pull` writes into `PAIN_MODELS_DIR` and works without a running backend:

```sh
./ai pull https://huggingface.co/.../file.gguf
./ai pull hf.co/owner/repo/file.gguf
./ai pull owner/repo:file.gguf
./ai pull qwen3.8:27b-q8_0
```

Partial downloads resume from `<name>.gguf.part`. `--sha256` verifies the
finished file, `--force` replaces an existing one, and `HF_TOKEN` is used for
gated Hugging Face repos. Ollama tags are pulled into `PAIN_MODELS_DIR/ollama`
and hardlinked to `PAIN_MODELS_DIR/<tag>.gguf`; nothing is duplicated.

## Container runtime and experimental Mac support

Set `PAIN_RUNTIME=docker` (default) or `PAIN_RUNTIME=podman` in `.env`.
All inference, model-import/download containers and lab commands use that runtime.
Podman needs a Compose provider (`podman-compose` or another configured provider).
Stop pain(less) with the old runtime before switching; recorded runtime ownership
prevents accidentally managing a different engine. Rootless Podman failures do
not trigger sudo/pkexec into a different container store.

Apple Silicon testing uses `llamacpp-metal`: a Linux ARM64 server with VirtGPU
forwarding to the real host Metal backend. It requires an APIR-enabled libkrun
virtualization stack; stock Podman GPU support alone is insufficient. The Mac
launcher runs Python in a controller container. See [Mac setup and acceptance
checks](docs/macos.md) before running `./integrations/macos/ai up llamacpp-metal`.
The Mac QA workflow packages a Tauri tray app with private APIR/Metal libraries.
It is ready for hardware QA, not yet a validated Mac release. See `desktop/`
for Storybook stories for the web tray and native Omarchy panel captures.

## Daily commands

```sh
./ai up rocm                         # Start backend, wait for API, apply all presets
./ai up vulkan                       # Replace the same service with Vulkan
./ai status                          # Container and loaded-model status
./ai logs                            # Follow server logs; Ctrl-C exits
./ai down                            # Stop/remove pain(less) container; keep models
./ai config rocm                     # Inspect resolved Compose configuration
./ai pull qwen3.8:27b-q8_0            # Download/export a model into PAIN_MODELS_DIR
./ai apply qwen38-q8-tuned            # Create/update the tuned model preset
./ai run qwen38-q8-tuned --keepalive=-1
```

Both backends use one Compose project (`pain`) and one service (`engine`).
Switching backends recreates that service, interrupts active requests, and unloads
the model. The same `PAIN_MODELS_DIR` is shared. ROCm explicitly disables Vulkan
discovery; the Vulkan setup uses the standard image with Vulkan enabled.
It also sets `OLLAMA_IGPU_ENABLE=1`: Ollama 0.40.13 otherwise filters out Vulkan
integrated GPUs, including the Radeon 8060S, even when Vulkan is enabled.
Check startup logs for the actual selected GPU and full layer offload.

To call `ai` from anywhere, optionally symlink the launcher:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/ai" ~/.local/bin/ai
```

The launcher resolves its own location, so it works outside this directory.

## Three levels of configuration

| Level | Files / interface | Examples |
|---|---|---|
| Runtime | `compose.yaml`, `backends/*.yaml`, `.env` | GPU backend, image version, port, global KV precision |
| Saved model | `models/<family>/*.Modelfile` | Context, batch size, draft length, sampling |
| Experiment | `ai bench`, Ollama API, interactive `/set parameter` | Temporary parameter sweeps |

Changing `.env` requires `ai up <backend>` to recreate the service. Changed
Modelfiles are reapplied on every `ai up`; use `ai apply <preset>` to update just
one without restarting. A failed preset application makes `ai up` exit with an
error rather than reporting readiness; the server remains available for fixing
the issue. Ollama may download missing base models while creating presets.
Request options override model defaults;
model context parameters override the server context default.

### Current Qwen3.8 Q8 leader

| Preset | Draft tokens | Batch | Context | CPU threads |
|---|---:|---:|---:|---:|
| `qwen38-q8-tuned` | 3 | 512 | 65536 | 16 |

Uses Qwen's thinking-mode sampling defaults:
temperature 1, top-p .95, top-k 20, min-p 0, presence penalty 0, repeat penalty 1.
The MTP head is embedded in this model. Presets reference shared weight blobs;
creating them does not duplicate the model download. This is the current Vulkan
leader, reported at roughly 10 tokens/sec in interactive use, not a controlled
benchmark. Earlier experimental presets have been retired.

For another model, add `models/<family>/<name>.Modelfile`; it appears automatically
under `ai presets` as `<family>-<name>`. Start from that model's own recommended
sampling settings. Only enable MTP on models that actually support it.

## Benchmarks

```sh
./ai bench qwen38-q8-tuned --drafts 0 2 4 6 --repeats 3 \
  --note 'AC power, performance mode, original charger'

./ai bench qwen38-q8-tuned --batches 512 2048 --repeats 3

./ai bench qwen38-q8-tuned --prompt benchmarks/prompts/reasoning.txt \
  --think on --tokens 1024 --note 'Reasoning workload'
```

Runs are sequential. Before each fresh/repeat pair, the target model is unloaded.
The first request measures a fresh prompt (load time recorded separately); the
second repeats the exact prompt to observe cache reuse if supported. Repeat
requests are not conversational follow-ups. Larger prompts are needed to assess
long-context performance; the included prompts are short smoke workloads.

The benchmark defaults to greedy sampling, seed 42, thinking **off**, 256 output
tokens, and 64k context to control comparisons. This is not Qwen's recommended
general-use sampling and is not a quality evaluation. It never writes these
overrides back into the preset. With `--think on`, thinking uses the output budget.
Every run leaves the model warm for 30 minutes.

Results are appended immediately to ignored `benchmarks/results/*.jsonl` files:

- Backend, Ollama version, immutable local image ID, and runtime environment.
- Model details/parameters, loaded-model digest, exact request overrides.
- Prompt hash/path, template hash, power profile when readable, and manual notes.
- Raw timing/count fields, generated tokens/sec, uncached prompt tokens/sec when
  the API reports cached token counts, and output text for comparison.

Inspect `done_reason`: hitting the token limit can truncate answers. Compare
multiple runs and representative prompts, not just one favorable continuation.
Keep AC power, power profile, model, sampling, and occupied context identical
between ROCm/Vulkan comparisons. Don't issue other inference requests during a
sweep. CPU/GPU telemetry and automatic quality scoring are not implemented yet.

## Training lab

The lab runs repeatable CPU training jobs in a pinned PyTorch image, separate
from the inference backends. It exists so research agents never hand-roll
environments: one image, one provenance trail, one dataset cache.

```sh
./ai lab build
./ai lab run --code ~/Projects/ryangavin/scalespace/swarms/track_b_tools \
  --seed 0 --threads 8 -- python train.py --alpha 1.0 --lam 1e-4
./ai lab shell --code ~/Projects/ryangavin/scalespace/swarms/track_b_tools
```

- `./ai lab build` builds `pain-lab` from `lab/Dockerfile` (torch 2.15.0 CPU
  wheels, numpy, matplotlib, tqdm) and prints the image ID.
- `./ai lab run` executes a command inside that image. The code directory is
  mounted at `/workspace/code`, the experiments directory (default:
  `experiments/`, see `PAIN_LAB_EXPERIMENTS`) at `/workspace/experiments`, and
  a named `pain-lab-data` volume at `/data` for dataset caches. Determinism
  env: `PYTHONHASHSEED=0`, `OMP_NUM_THREADS`/`MKL_NUM_THREADS` from
  `--threads`, and `SEED` from `--seed`; job scripts must read `SEED`.
- Every run appends a provenance row (utc, image ID, command, code git rev,
  threads, seed, exit code, duration) to ignored `experiments/lab_runs.jsonl`.
- `./ai lab shell` opens an interactive shell with the same mounts; it does
  not write a provenance row.
- `--code` defaults to `PAIN_LAB_CODE` in `.env`. The command goes after all
  options and is passed through unchanged.

Lab runs do not touch the inference container; they can execute while a model
is loaded, at the cost of CPU contention on timing-sensitive benchmarks.

## Versioning and storage

Image defaults are pinned to Ollama **0.40.13**, the version used during initial
tuning. Override `PAIN_ROCM_IMAGE` / `PAIN_VULKAN_IMAGE` in `.env` when testing a
new version. A digest (`ollama/ollama@sha256:...`) provides stronger pinning than
a tag. Benchmark output records the local image ID either way.

`.env`, machine state, and benchmark results are ignored by Git. Model weights
live under `PAIN_MODELS_DIR`, not this repo. Inspect results before explicitly sharing
them: they contain generated text and metadata about your prompts.

Current hardware baseline: full layer offload, Flash Attention, F16 KV, one
loaded model, one request slot, and performance mode on AC. Increasing available
GPU memory is a capacity adjustment, not inherently a speed optimization.

## Checks

```sh
python -m unittest discover -s tests -v
./ai config rocm
./ai config vulkan
```

Tests use a local fake Ollama API; they require neither a GPU nor Docker access.
Compose rendering validates configuration without starting a container.

## References

- [Ollama hardware support](https://docs.ollama.com/gpu)
- [Ollama runtime configuration](https://docs.ollama.com/faq)
- [Qwen3.8-27B official model card](https://huggingface.co/Qwen/Qwen3.8-27B)

Future additions: telemetry capture, result comparison, and more model
families. The Ollama and llama.cpp server backends and the training lab can
be extended without turning each parameter combination into a separate
Compose setup. See `TODO.md` for storage notes.

## Omarchy dropdown (linked development install)

Run once from this checkout:

```sh
./integrations/omarchy/install
```

This validates the plugin, backs up `~/.config/omarchy/shell.json`, symlinks
`~/.config/omarchy/plugins/local.pain` to the repo, and enables an **AI** button
on the right of the bar. It refuses to overwrite an unrelated plugin.
The panel shows the same telemetry as `paintop`: the live slot (model, prompt
and KV-cache hit, draft mode, speed, context used of the window), host RAM split
into weights / draft / KV+compute / system with a tick at the GTT ceiling, GTT
used of total, swap, GPU load, package power, and thermals. Pick a backend chip
and press Start (or Restart). Stop, Monitor, and Logs sit alongside it, and the
panel is keyboard-driven: h/l walk chips, j/k switch rows, Enter activates,
S/D/M/G/R start/stop/monitor/logs/refresh. Left-click the bar glyph for the
panel, right-click for `paintop`, middle-click to refresh.
Starting or switching replaces the running pain(less) container and interrupts requests.

Start, Restart, and Stop run in the background: the hero shows the adapter's
progress, the action buttons stay disabled until it exits, and a desktop
notification reports the result (a failure also stays in the panel caption until
the next action). Without a terminal the adapter escalates with pkexec if your
user cannot access Docker. Monitor and Logs still open a terminal, and the CLI
(`./ai up <backend>` etc.) keeps its sudo prompt and "Press Enter" behaviour.
Simultaneous desktop start/stop commands are rejected. Existing CLI commands
remain usable. This does not start inference at login or change Docker permissions.

Edit `integrations/omarchy/pain/Widget.qml` directly for UI changes. Omarchy's
plugin watcher does not follow the symlink into this checkout, and
`omarchy-shell shell rescanPlugins` only re-reads manifests, so reload widget
code with:

```sh
omarchy restart shell
```

Python adapter, `ai`, `paintop`, Compose, and preset edits are read from this
checkout on the next invocation; no reinstall or packaging step is needed.
Telemetry polls every 10 seconds while closed and every 2 seconds while open.
Online means the local inference API responds, not proof of container ownership.
Keep the checkout in place; if you move it, remove only the old symlink and
rerun the installer. To hide the integration: `omarchy plugin disable local.pain`.
## ComfyUI image generation (Linux)

`./ai up comfyui` detects AMD or NVIDIA and replaces the LLM container with
ComfyUI at <http://127.0.0.1:8188>. With both vendors present, select
`--device rocm` or `--device cuda`. ComfyUI is not offered on macOS.
The default AMD image targets Strix Halo (including the Z13's 8060S); other AMD
GPUs need a compatible image override. NVIDIA needs Container Toolkit.

A GPU preflight runs before replacing the active engine. Models, workflows,
custom nodes and generated images stay in `~/.local/share/pain/comfyui` across
restarts and switches. `./ai up llamacpp-vulkan` switches back. The usual `status`,
`logs`, and `down` commands work for ComfyUI.

See [ComfyUI setup, image pins, and validation](docs/comfyui.md), including
MiniMax H3-Image templates and the distinction between automated checks and
live GPU acceptance.
