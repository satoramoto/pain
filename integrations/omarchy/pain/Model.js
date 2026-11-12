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

function modelTooLarge(model, memory) {
  // The Mac catalog reports physical RAM in bytes. Native Linux telemetry is
  // an object and must not be interpreted as a Mac GPU memory limit.
  return typeof memory === "number" && memory > 0 && num(model.bytes) > memory * 0.7
}

function modelProgress(model) {
  return num(model.bytes) > 0 ? Math.min(99, Math.floor(num(model.received) * 100 / model.bytes)) : 0
}

function modelState(model, status) {
  if (status.online && status.model_alias === model.id) return "Running"
  if (status.fetching === model.id) return "Downloading… " + modelProgress(model) + "%"
  if (model.downloaded) return model.selected ? "Downloaded · selected" : "Downloaded"
  if (modelTooLarge(model, status.memory)) return "Too large for this Mac"
  if (!model.downloadable) return "No download source"
  return model.received ? modelProgress(model) + "% downloaded" : "Not downloaded"
}

function removalReason(model, status) {
  if (status.online) return "Stop the engine before removing model files."
  if (model.remove_blocked) return String(model.remove_blocked)
  if (model.removable !== true) return "Removal is unavailable for these files."
  return ""
}

function known(value) {
  return value !== undefined && value !== null && value !== "" && isFinite(Number(value))
}

// Shared presentation and action contract. Native QML retains its original
// controls and layout; the Mac binding draws the same anatomy from these values.
function panelState(status, host) {
  host = host || {}
  var online = status.online === true
  var loaded = !!status.model_alias
  var inf = status.inference || {}
  var hw = status.hardware || {}
  var mem = status.memory && typeof status.memory === "object" ? status.memory : {}
  var split = status.memory_split || {}
  var generating = online && inf.processing === true
  var busy = host.busyAction || status.busy || ""
  var mac = host.platform === "mac"
  var action = String(busy).toLowerCase()
  var meta = !online ? "Offline · " + (status.backend || "no backend")
    : engineLabel(status) + " · " + (!loaded ? "no model loaded" : generating ? "generating" : "idle")
  if (action === "up" || action === "starting") meta = "Starting " + (host.busyBackend || status.backend || "engine") + "…"
  else if (action === "down" || action === "stopping") meta = "Stopping engine…"
  else if (busy) meta = String(busy)
  else if (status.error) meta = String(status.error)
  var detail = busy ? (host.controlLine === undefined ? status.controlLine || String(busy) : host.controlLine)
    : !online ? "" : generating ? speedText(host.speed === undefined ? status.speed : host.speed) : loaded ? "Ready" : "Standby"
  var available = status.runtimeReady !== false
  var actions = [
    { key: "up", label: action === "up" || action === "starting" ? "Starting…" : online ? "Restart" : "Start", icon: "󰐊", tip: "Start the selected backend, replacing any running engine", enabled: !busy && available },
    { key: "down", label: action === "down" || action === "stopping" ? "Stopping…" : "Stop", icon: "󰓛", tip: "Stop the engine and unload the model", enabled: !busy && online }
  ]
  if (!mac) actions.push({ key: "top", label: "Monitor", icon: "󰍹", tip: "Open paintop in a terminal", enabled: true })
  actions.push({ key: "logs", label: "Logs", icon: "󰆍", tip: mac ? "Show engine logs" : "Follow engine logs in a terminal", enabled: mac ? !busy && available : online })
  var memoryAvailable = known(mem.total_gib) && num(mem.total_gib) > 0
  var gttAvailable = known(hw.gtt_total_gib) && num(hw.gtt_total_gib) > 0
  return {
    online: online, loaded: loaded, generating: generating, busy: !!busy,
    meta: meta, detail: detail, actions: actions,
    inference: {
      model: status.model_alias || "none loaded",
      prompt: inf.has_slot ? kTokens(inf.prompt) + " tokens · KV " + cacheHitText(inf) : "—",
      draft: loaded ? draftText(inf, status) : "—",
      speed: generating ? speedText(host.speed === undefined ? status.speed : host.speed) : loaded ? "idle" : "—",
      context: contextText(inf), fraction: contextFraction(inf)
    },
    memory: {
      available: memoryAvailable, ram: memoryAvailable ? gibPair(mem.used_gib, mem.total_gib) : "Unavailable",
      total: num(mem.total_gib), segments: status.memory_split ? ramSegments(split, loaded) : [],
      gtt: gttAvailable ? gibPair(hw.gtt_used_gib, hw.gtt_total_gib) : "Unavailable",
      gttRatio: known(split.gtt_ratio) ? clamp01(split.gtt_ratio) : gttAvailable ? clamp01(num(hw.gtt_used_gib) / hw.gtt_total_gib) : 0,
      gttCap: memoryAvailable && gttAvailable ? gttCapFraction(hw, mem) : -1,
      gttCaption: gttAvailable ? "GTT cap " + num(hw.gtt_total_gib).toFixed(0) + " GiB (" + (known(split.gtt_share_pct) ? num(split.gtt_share_pct) : Math.round(gttCapFraction(hw, mem) * 100)) + "% of RAM)" : "",
      swap: status.swap ? swapText(status.swap) : "Unavailable"
    },
    hardware: {
      gpu: known(hw.gpu_busy_pct) ? Math.round(num(hw.gpu_busy_pct)) + "%" : "Unavailable",
      gpuFraction: known(hw.gpu_busy_pct) ? clamp01(num(hw.gpu_busy_pct) / 100) : 0,
      power: known(hw.ppt_w) ? num(hw.ppt_w).toFixed(1) + " W" : "Unavailable",
      powerFraction: known(hw.ppt_w) ? clamp01(num(hw.ppt_w) / 70) : 0,
      thermals: tempsText(hw) === "—" ? "Unavailable" : tempsText(hw)
    }
  }
}
