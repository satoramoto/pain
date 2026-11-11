// Pure helpers for the PAIN panel. No QML state lives here so the panel
// stays declarative and these stay unit-testable in isolation.
.pragma library

function num(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback)
}

function clamp01(value) {
  return Math.max(0, Math.min(1, num(value)))
}

function gib(value) {
  var n = Number(value)
  return isFinite(n) ? n.toFixed(1) + " GiB" : "—"
}

function gibPair(used, total) {
  return gib(used) + " / " + gib(total)
}

function kTokens(value) {
  var n = num(value)
  if (n >= 1024) return (n / 1024 >= 100 ? Math.round(n / 1024) : (n / 1024).toFixed(n >= 10240 ? 0 : 1).replace(/\.0$/, "")) + "k"
  return String(Math.round(n))
}

function contextText(inf) {
  var used = num(inf.prompt) + num(inf.decoded)
  var total = num(inf.n_ctx)
  if (total <= 0) return "—"
  return kTokens(used) + " / " + kTokens(total)
}

function contextFraction(inf) {
  var total = num(inf.n_ctx)
  if (total <= 0) return 0
  return clamp01((num(inf.prompt) + num(inf.decoded)) / total)
}

function engineLabel(status) {
  var backend = String(status.backend || "")
  if (status.engine === "llama.cpp") return "llama.cpp" + (backend.indexOf("cpu") >= 0 ? " · CPU" : backend.indexOf("metal") >= 0 ? " · Metal (VirtGPU)" : " · Vulkan")
  if (status.engine === "ollama") return "Ollama · " + (backend || "vulkan")
  return backend || "—"
}

function cacheHitText(inf) {
  if (!inf || inf.cache_hit_pct === null || inf.cache_hit_pct === undefined) return "warm"
  return inf.cache_hit_pct + "% hit"
}

function draftText(inf, status) {
  var spec = inf && inf.speculative
  return spec ? "DFlash 16-token draft" : "Unassisted"
}

// Segments of host RAM, in the order the stacked bar paints them. `split` is
// paintop's split_memory() result; GTT pages are part of host RAM, so the GPU
// segments (Base/Draft/KV) and Sys together equal used memory.
function ramSegments(split, modelLoaded) {
  return [
    { key: "base", label: "Weights", value: num(split.base) },
    { key: "draft", label: "Draft", value: num(split.draft) },
    { key: "kv", label: modelLoaded ? "KV + compute" : "GPU", value: num(split.kv) },
    { key: "sys", label: "System", value: num(split.sys) }
  ]
}

function gttCapFraction(hw, mem) {
  var total = num(mem.total_gib)
  if (total <= 0) return -1
  return clamp01(num(hw.gtt_total_gib) / total)
}

function speedText(tokPerSec) {
  var n = num(tokPerSec)
  return n > 0 ? n.toFixed(1) + " tok/s" : "—"
}

function tempsText(hw) {
  var parts = []
  if (num(hw.gpu_temp_c) > 0) parts.push("GPU " + Math.round(num(hw.gpu_temp_c)) + " °C")
  if (num(hw.cpu_temp_c) > 0) parts.push("CPU " + Math.round(num(hw.cpu_temp_c)) + " °C")
  if (num(hw.sclk_mhz) > 0) parts.push(Math.round(num(hw.sclk_mhz)) + " MHz")
  return parts.length ? parts.join(" · ") : "—"
}

function swapText(swap) {
  if (!swap || num(swap.total_gib) <= 0) return "none"
  var parts = []
  if (num(swap.zram_total_gib) > 0) parts.push("zRAM " + num(swap.zram_used_gib).toFixed(1))
  if (num(swap.nvme_total_gib) > 0) parts.push("NVMe " + num(swap.nvme_used_gib).toFixed(1))
  return parts.join(" · ") + " of " + num(swap.total_gib).toFixed(0) + " GiB"
}
