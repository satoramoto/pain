# PAIN — Private AI Network

A personal library of local AI runtimes, model presets, and repeatable experiments.
Built initially for a 64 GB ASUS ROG Flow Z13 with a Ryzen AI Max+ 395 / Radeon
8060S on Linux. Currently serves one localhost-only Ollama instance at a time.

## Quick start

Requirements: Python 3.10+, Docker Engine, Docker Compose, and a working host
AMD GPU driver. Python uses only its standard library. ROCm needs `/dev/kfd`
and `/dev/dri`; Vulkan needs `/dev/dri`.

```sh
cd ~/Projects/satoramoto/pain
cp .env.example .env
./ai up rocm
opencode
```

Every `ai up` waits for Ollama, then creates/updates **all checked-in presets**.
OpenCode V2 discovers them through the localhost Ollama API; select one with
`/models`. OpenCode runs on the host as your normal user, even if you start PAIN
with sudo. You can also use `./ai run qwen38-q8-tuned` for Ollama's own chat.
New Modelfiles are picked up automatically on the next `ai up`.

If Docker requires sudo, use `sudo ./ai ...` for the commands above. The launcher
does not change your Docker permissions. Use the repo's `.env` for configuration
when running with sudo, since sudo may strip shell environment variables.

### Adopt the existing Ollama installation

PAIN uses the **existing external Docker volume `ollama`**. Models, saved MTP
parameters, and named presets in that volume survive container replacement.
Before the first start, stop the old container that owns port 11434:

```sh
sudo docker stop ollama
sudo ./ai up rocm
```

The old container stays available for rollback. Stop PAIN with `sudo ./ai down`
before restarting it. Never run both containers against the same volume at once,
even if their ports differ. PAIN itself does not stop containers it doesn't own.
If the old container has a different name, use that name instead of `ollama`.

For a fresh installation, create the external volume first with
`docker volume create ollama`, then download the base model:

```sh
./ai pull qwen3.8:27b-q8_0
```

No models are downloaded or containers started just by cloning this repo.

## Daily commands

```sh
./ai up rocm                         # Start backend, wait for API, apply all presets
./ai up vulkan                       # Replace the same service with Vulkan
./ai status                          # Container and loaded-model status
./ai logs                            # Follow server logs; Ctrl-C exits
./ai down                            # Stop/remove PAIN container; keep models
./ai config rocm                     # Inspect resolved Compose configuration
./ai apply qwen38-q8-tuned            # Create/update the tuned model preset
./ai run qwen38-q8-tuned --keepalive=-1
```

Both backends use one Compose project (`pain`) and one service (`ollama`).
Switching backends recreates that service, interrupts active requests, and unloads
the model. The named model volume is shared. ROCm explicitly disables Vulkan
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

## Versioning and storage

Image defaults are pinned to Ollama **0.40.13**, the version used during initial
tuning. Override `PAIN_ROCM_IMAGE` / `PAIN_VULKAN_IMAGE` in `.env` when testing a
new version. A digest (`ollama/ollama@sha256:...`) provides stronger pinning than
a tag. Benchmark output records the local image ID either way.

`.env`, machine state, and benchmark results are ignored by Git. Model weights
live in Docker storage, not this repo. Inspect results before explicitly sharing
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

Future additions: standalone llama.cpp backend, telemetry capture, result
comparison, and more model families. These can be added without turning each
parameter combination into a separate Compose setup.
