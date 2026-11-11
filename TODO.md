# TODO

## Storage: stop Ollama from duplicating GGUFs into its blob store

**Status:** DONE (2026-11-07)
**Area:** `ai` (`apply()`, `pull()`), `PAIN_MODELS_DIR`, Ollama backends
**Impact:** ~20–30 GB hidden copy per model

### Problem

All model weights live under `PAIN_MODELS_DIR` (`~/Models`) and are mounted at
`/models`. Presets reference those GGUFs directly, so the llama.cpp backend reads
them in place with no extra storage.

The Ollama backends could not do that. `ollama create` imports a
`FROM /models/*.gguf` layer into its content-addressed store at
`$OLLAMA_MODELS/blobs` (`~/Models/ollama/blobs`). On this single filesystem, that
was a byte-for-byte duplicate, not a reference. Examples:

- `Qwen3.8-27B-Q8_0.gguf` — 28 GB copied
- `Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf` — 19 GB copied

### Implemented

`dedupe_ollama_import()` runs after every `ollama create`:

1. Parse the preset's `FROM /models/<file>`; skip registry/HF tags.
2. Find the manifest under `manifests-v2/ollama.com/...` (falling back to the
   legacy `manifests/...` layout).
3. Read the `application/vnd.ollama.image.model` layer digest and confirm the
   blob exists and matches the source size.
4. Try a host-side hardlink first. Linux `fs.protected_hardlinks` blocks links to
   root-owned Ollama blobs when `ai` runs as a normal user, so on failure it runs
   `ln -f` inside the running engine container (root).
5. Verify the inode changed; otherwise leave the copy and print a warning.

`pull_ollama()` uses the same approach when exporting an Ollama tag to a plain
GGUF, with a final copy fallback if linking is impossible.

### Acceptance criteria

- [x] `apply` leaves the source GGUF and `ollama/blobs/sha256-<digest>` with the
      same inode (`stat -c %i`).
- [x] Hardlink path verified end-to-end with `qwen2.5:0.5b` (645 MB) on the
      Vulkan backend.
- [x] `ai pull qwen2.5:0.5b` exports a plain GGUF that shares the Ollama blob
      inode.
- [x] llama.cpp presets are unchanged.
- [x] Cross-filesystem or failed-link cases fall back to a copy.

### Edge cases / notes

- Only local `/models/*.gguf` imports are de-duplicated. Registry pulls and
  `hf.co/...` imports have no host source to link.
- Do not modify either file in place after linking; replacing the source path
  (`mv`/re-download) breaks the link relationship, though the blob stays valid.
- Ollama may change its manifest layout; the lookup is tolerant and skips
  de-duplication if no model layer is found.
- If Ollama adds native external-GGUF references, prefer that over this shim.
