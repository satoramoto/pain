# Optimization Log & Experiment Matrix

Target hardware: **ASUS ROG Flow Z13** — AMD Ryzen AI Max+ 395 (2× 8-core Zen 5 CCDs) + Radeon 8060S (`gfx1151`, 40 CUs, 2900 MHz max `sclk`), 64 GB LPDDR5X-8533 (~215 GB/s sustained bandwidth).

## Current Baseline
- **OS / GPU Driver**: Linux `7.2.8-9-omarchy`, Mesa `26.2.5` (RADV), `ttm.pages_limit=11534336` (44 GiB GTT + 4 GiB VRAM = 48 GiB GPU-accessible), `zswap.enabled=0`, THP `[always]`, CPU governor & ACPI profile `performance`.
- **Runtime**: Ollama `0.40.13`, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=f16`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`.
- **Model**: `qwen3.8:27b-q8_0` (29.98 GB, hybrid 48 SSM + 16 Full-Attention + 1 MTP layer, includes CLIP `--mmproj`), `num_ctx=65536`, `num_thread=16`, `num_batch=512`, `draft_num_predict=2`.

---

## Priority-Ranked Experiment Matrix

Ordered by **estimated performance impact** (highest first). We test **one variable at a time** against the running best configuration:
- **PP Benchmark**: `benchmarks/prompts/long.txt` (~2,400 tokens, `num_predict=32`) → measures `uncached_prompt_tokens_per_second`.
- **TG Benchmark**: `benchmarks/prompts/code.txt` (~45 tokens, `num_predict=256`) → measures `generation_tokens_per_second`.

| Priority / ID | Category | Change / Hypothesis | Est. Impact | Baseline (PP / TG) | Result (PP / TG) | Status | Notes |
|---|---|---|---|---|---|---|---|
| `P0` (`E00`) | Harness | Fix `prompt_eval_cached_count` `omitempty` bug in `./ai`, add `--threads`/`--temperature`, hwmon telemetry, and `benchmarks/prompts/long.txt` | Required | — | `286.4 / 15.63` (`b=2048, d=4, temp=1`) | `KEPT` | Baseline established on `qwen38-q8-tuned` (Vulkan, 3,165 prompt tok, 70W PPT, 34.0 GiB GTT + 3.9 GiB VRAM) |
| `P1` (`E11`) | Quant & MMProj | Head-to-head `qwen38-local` (`UD-Q6_K`, 22 GB) vs `qwen3.8:27b-q8_0` (30 GB) across `think=off` and `think=on` | **+30–40% TG (`think=off`)**, but **`Q8_0` wins `think=on`** | `Q8_0`:<br>`think=off`: `307.6 / 16.06`<br>`reasoning (think=on)`: `125.8 / 19.65`<br>`long (think=on)`: `298.1 / 16.25` | `UD-Q6_K`:<br>`think=off`: `262.5 / 23.13`<br>`reasoning (think=on)`: `160.7 / 16.34`<br>`long (think=on)`: `246.3 / 15.40` | `REJECTED` for thinking (`Keep Q8_0`) | **Plot twist**: `UD-Q6_K` wins `think=off` (`23.1` vs `16.1 tok/s`), **but `Q8_0` beats `UD-Q6_K` with `think=on` (`19.65` vs `16.34 tok/s` on reasoning; `298.1` vs `246.3 PP` and `16.25` vs `15.40 TG` on `long.txt`)**. `UD-Q6_K` degrades into telegraphic `<think>` text (`"We need solve problem..."`) that tanks MTP draft acceptance and lacks Ollama's `qwen3.8` thinking parser |
| `P2` (`E07`) | MTP Drafts | Sweep `draft_num_predict` (`0`, `1`, `2`, `3`, `4`) at preset `temp=1.0` (`b=512`) | **+40–90% TG** vs `0` | `15.63 tok/s` (`d=4`) | `Q8_0`: `d=0: 7.68`, `d=1: 12.37`, `d=2: 14.77`, **`d=3: 16.06`**, `d=4: 15.63`<br>`Q6_K`: `d=0: 9.72`, `d=1: 16.42`, `d=2: 20.95`, **`d=3: 23.13`**, `d=4: 23.22` | `KEPT` (`3`) | **`draft_num_predict=3` wins on `Q8_0` at `temp=1.0`** (`16.06 tok/s` with `think=off`, **`19.90 tok/s` with `think=on`**) and is rock-solid (`23.13 tok/s`) on `UD-Q6_K` |
| `P3` (`E02`) | CPU Threads | Sweep `num_thread` (`16` → `8` → `4` → `2`) with 100% GPU offload | **+10–25% PP**, -35W CPU | `298.4 / 18.23` (`16t`) | `Q8_0`: `16t: 298.4/18.23`, `8t: 293.3/18.32`, `4t: 286.9/18.26`<br>`Q6_K`: `16t: 259.0/22.12`, **`8t: 259.2/22.56`**, `4t: 258.4/22.13` | `REJECTED` on `Q8_0` (Keep `16`) | `16` threads wins on `Q8_0` (+5% PP); `8` threads slightly edges out `16` on `UD-Q6_K` |
| `P4` (`E03`) | Backend | Compare `vulkan` (RADV) vs `rocm` (HIP) on identical preset | **15–40% PP / TG swing** | `307.6 / 18.33` | — | `SKIPPED` (User selected Vulkan) | Focusing all optimization passes on Vulkan backend |
| `P5` (`E06`) | Batch (`-b`/`-ub`) | Sweep `num_batch` (`256`, `512`, `1024`, `2048`) on `long.txt` | **+15–35% PP** | `Q8_0 (2048)`: `286.4 / 18.18`<br>`Q6_K (2048)`: `241.8 / 21.84` | `Q8_0 (512)`: **`307.6 / 18.33`**<br>`Q6_K (512)`: **`262.5 / 22.29`** | `KEPT` (`512`) | **`num_batch=512` wins on both models**: **+7.4% PP on `Q8_0`**, **+8.6% PP on `UD-Q6_K`**, and **saves 1.7 GiB GTT** |
| `P6` (`E01`) | CCD Pinning | Pin container `cpuset: "0-7"` (CCD0 physical cores only) | **+5–12% consistency** | — | — | `TODO` | Eliminates cross-CCD Infinity Fabric barrier latency and SMT sibling contention |
| `P7` (`E08`) | KV Cache | Test `OLLAMA_KV_CACHE_TYPE=q8_0` vs `f16` | **+5–15% long-ctx**, -50% KV RAM | — | — | `TODO` | Halves KV cache memory traffic across the 16 full-attention layers |
| `P8` (`E04`/`E05`) | Driver Env | Vulkan `RADV_PERFTEST=nosam`; ROCm `HSA_ENABLE_SDMA=0` + `ROCBLAS_USE_HIPBLASLT=1` | **+3–10% PP / TG** | — | — | `TODO` | Tunes driver heuristics for 4 GiB VRAM + 44 GiB GTT unified memory |
| `P9` (`E09`/`E10`) | Host / Kernel | `ttm.page_pool_size=4194304` + GPU `power_dpm_force_performance_level=high` | **Faster TTFT & load** | — | — | `TODO` | Caches WC/UC DMA pages for reloads and eliminates 600→2900 MHz SMU wake lag |
| `M1` (`MUSE-batches`) | Muse Glimmer Batch | Sweep `num_batch` (`256`, `512`, `1024`, `2048`) on `long.txt` (`muse-glimmer-q4-experimental`) | **Portability check** | `2048`: `273.6 PP / 10.63 TG` (`21.0 GiB GTT`) | **`512`: `281.0 PP / 10.76 TG`** (`19.8 GiB GTT`)<br>`256`: `276.6 / 10.80`<br>`1024`: `276.2 / 10.65` | `KEPT` (`512`) | **`num_batch=512` ports directly from Qwen**: beats `2048` by **+2.7% PP**, **+1.2% TG**, and saves **1.2 GiB GTT** |
| `M2` (`MUSE-threads`) | Muse Glimmer Threads | Sweep `num_thread` (`16` → `8` → `4`) on `long.txt` (`b=512, temp=1.0, 128 tok`) | **Single-CCD fit** | `16t`: `270.2 PP / 10.67 TG` (`64.5W PPT`) | **`8t`: `272.3 PP / 10.75 TG`** (`63.4W PPT`)<br>`4t`: `270.2 PP / 10.75 TG` (`62.5W PPT`) | `KEPT` (`8`) | Unlike hybrid `qwen35` (48 SSM layers), `muse-glimmer` is a pure 52-layer GQA transformer (`head_count_kv=2`, 0 SSM layers). **`8` threads wins both PP and TG** with lower PPT and faster load (`3.5s` vs `4.0s`) |
| `M3` (`MUSE-h2h`) | Muse Glimmer vs Qwen | Head-to-head `muse-glimmer-q4-experimental` (19.65 GB) vs `qwen38-q8-tuned` (30 GB) & `UD-Q6_K` (22 GB) | **Cross-model baseline** | `Qwen Q8_0 (d=0)`: `7.68 TG`<br>`Qwen Q8_0 (d=3, think=on)`: `19.65 TG` | `Muse Q4_K_XL (d=0)`:<br>`code.txt`: `180.8 PP / 10.81 TG`<br>`reasoning.txt`: `203.2 PP / 10.75 TG` | `RECORDED` | **+40.8% faster raw `draft=0` TG** than `Q8_0` (`10.81` vs `7.68 tok/s`), **19.8 GiB GTT** (12.5 GiB less than `Q8_0`), and **3.5s load time** (vs `9.8s`). Lacks embedded MTP drafter (`d=0` vs `Q8_0`'s `d=3` at `19.65 tok/s`) |

*(Status values: `TODO`, `TESTING`, `KEPT`, `REJECTED`, `PARTIAL`, `RECORDED`)*

---

## Summary of Bottlenecks
1. **Memory Bandwidth & Speculative Decoding (`P1`, `P2`, `P7`)**: At ~215 GB/s sustained bandwidth, 30 GB `Q8_0` weights cap non-speculative TG at ~7.5–8.0 tok/s. Moving to 22 GB `UD-Q6_K` and tuning `draft_num_predict` under real sampling (`temperature=1.0`) gives the largest TG gain.
2. **APU Shared Power & Dual-CCD Contention (`P3`, `P6`)**: 16 spinning `ggml` worker threads across both CCDs consume 30–50W of shared package PPT during 100% GPU-offloaded inference, starving the Radeon 8060S iGPU of power and Infinity Fabric bandwidth.
3. **Prompt Microbatching & Backend Kernels (`P4`, `P5`, `P8`)**: Ollama sets `-ub = -b`; tuning `num_batch` on a >2k-token prompt across RADV and ROCm maximizes 40-CU utilization without overflowing RDNA 3.5 cache tiles.
