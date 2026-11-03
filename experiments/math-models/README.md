# Math model experiments

Three opt-in profiles for comparison with `qwen38-q8-tuned` on PAIN's Vulkan
backend. These files are outside `models/`, so ordinary startup does not download
them. No changes to the shared launcher, runtime, or tuned Qwen preset are needed.

## Candidates

| PAIN preset after activation | Weight download | Purpose |
|---|---:|---|
| `minicpm5-math-q8-experimental` | 2.68 GB / 2.50 GiB | Inexpensive first trial of a small math specialist |
| `muse-glimmer-q4-experimental` | 19.65 GB / 18.30 GiB | Scientific coding and reasoning comparison |
| `nemotron-cascade2-q4-experimental` | 24.73 GB / 23.03 GiB | Python-assisted mathematical reasoning comparison |

HF filenames and sizes were checked against the live repository listings when
these profiles were added. Explicit filenames avoid choosing a projector or
draft model from a multi-file repo. Repositories may update those files: these
are filename-pinned, not immutable revision/digest pins. The first import adds
weight downloads to the existing Docker volume. Runtime memory is additional.

## Activate one profile

From the PAIN repo root, copy only the experiment you want into the active
library, then apply it:

```sh
mkdir -p models/minicpm5-math-q8
cp -n experiments/math-models/minicpm5-math-q8/experimental.Modelfile models/minicpm5-math-q8/
sudo ./ai apply minicpm5-math-q8-experimental
./ai run minicpm5-math-q8-experimental
```

Use `sudo ./ai run ...` too if your Docker permissions require it. `cp -n` avoids
overwriting a profile another experimenter has already activated or edited.
Ollama pulls the HF base on first creation if missing. Once copied, the profile
appears in `./ai presets` and gets reapplied automatically on future startup.
OpenCode should discover it after import if its metadata advertises completion.

For the other two candidates:

```sh
mkdir -p models/muse-glimmer-q4
cp -n experiments/math-models/muse-glimmer-q4/experimental.Modelfile models/muse-glimmer-q4/
sudo ./ai apply muse-glimmer-q4-experimental

mkdir -p models/nemotron-cascade2-q4
cp -n experiments/math-models/nemotron-cascade2-q4/experimental.Modelfile models/nemotron-cascade2-q4/
sudo ./ai apply nemotron-cascade2-q4-experimental
```

Profiles use 64k context, 512 prompt batch, 16 CPU threads and **speculation off**.
The Qwen-specific MTP4 optimization is not assumed to transfer to these models.
Sampling follows each model card where specified, with extra default filtering
and repetition penalties disabled. `num_predict=8192` is a PAIN experiment
budget, not a publisher recommendation: it caps total generated reasoning and
answer tokens and may truncate difficult proofs. Increase it for quality trials
when needed; a longer budget can take minutes at local generation rates.

## Compatibility and evaluation notes

- **MiniCPM5 Math:** creator's GGUF card explicitly documents Ollama. Q8 is the
  creator's recommended quant; published benchmark results used BF16 with much
  longer output budgets. It's a community derivative, not an OpenBMB math release.
- **Muse Glimmer:** requires upstream llama.cpp b10353+ and correct embedded chat
  template handling. Its reasoning cannot simply be disabled. This imports only
  the text GGUF: no image input or DFlash acceleration is configured. Compatibility
  with the exact Ollama build still requires a smoke test.
- **Cascade 2:** the official card explicitly says it does not currently support
  OpenCode and prioritizes OpenHands for agentic work. Begin with ordinary math
  chat; appearing in OpenCode's picker doesn't establish working tool calls.
  Its tool-response formatting differs from the standard role mapping.

None of these profiles has been loaded or benchmarked locally yet. Before an
extended comparison, check load success, GPU offload, sensible output, reasoning
format, and then a real tool round trip if you intend to use it in OpenCode.
Don't replace embedded templates with a generic Qwen template to force loading.

For a timing experiment after successful import:

```sh
./ai bench minicpm5-math-q8-experimental \
  --prompt benchmarks/prompts/reasoning.txt --think on --tokens 1024 \
  --note 'Vulkan; AC; performance mode; experimental MiniCPM5 Q8'
```

The benchmark's request options override preset sampling/output limits; its
greedy timing run isn't a reproduction of publisher quality results. For actual
scientific quality, compare executed Python/Wolfram results and plot data, not
only tokens/sec. A math specialist isn't automatically a good tool-using agent.

To retire an activated experiment, remove its copied Modelfile from `models/`
after coordinating with anyone using it, then delete that model alias from
Ollama if desired. The opt-in recipe here remains available for future trials.

## Sources

- [HF Ollama imports and exact filename tags](https://huggingface.co/docs/hub/en/ollama)
- [Muse official GGUFs and sampling](https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF)
- [Cascade model card and integration notes](https://huggingface.co/nvidia/Nemotron-Cascade-2-30B-A3B)
- [Cascade community GGUFs](https://huggingface.co/bartowski/nvidia_Nemotron-Cascade-2-30B-A3B-GGUF)
- [MiniCPM5 Math GGUFs and Ollama instructions](https://huggingface.co/Caldalis/MiniCPM5-2B-Math-GGUF)
