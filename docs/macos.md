# Apple Silicon QA

PAIN runs Linux ARM64 llama-server in a dedicated Podman/libkrun VM. VirtGPU
forwards computation to llama.cpp's real Metal backend in the Mac virtualization
process. The host APIR libraries cannot live inside the Linux container, so the
Mac runtime artifact bundles them alongside a private krunkit and its dynamic
library dependencies. It does not replace system or Homebrew libraries.

The Mac QA workflow builds two artifacts from this branch:

- `pain-macos-app-arm64`: a Tauri DMG, including the runtime archive and PAIN's
  controller sources. Use this for the tray application.
- `pain-macos-runtime-arm64`: the runtime tarball and SHA-256 file. Use this with
  a Git checkout when testing the CLI or changing code locally.

These are QA builds, ad-hoc signed rather than Developer ID signed/notarized.
A real Apple Silicon run is still needed before calling this a supported release.
The app targets macOS 15 or newer. CI builds the dylibs on Apple Silicon; Linux
checks only validate the container and cross-platform application code.

## App setup

1. Install the official Podman macOS package (the permitted virtualization
   dependency). No host Python, CMake, Rust, Node, or inference service is needed.
2. Download the app artifact from the **Mac QA** workflow for this branch. Open
   the DMG and copy PAIN to Applications. macOS may require Open Anyway for this
   unsigned-distribution QA build.
3. Open PAIN and click **Prepare VM**. This installs the private runtime under
   the application's user data directory, creates `pain-metal` if missing, and
   starts it. The first machine setup requires internet access for the Linux image.
4. Enter an HTTPS GGUF download URL for a small supported model. PAIN downloads
   into `~/Models` and registers a 32768-token preset. Click **Start** afterward.
   The first start builds the controller and inference containers in the VM.
5. Use the menu-bar PAIN entry to reopen the window. Closing the window hides it;
   quitting the UI keeps inference running. Use **Stop** to stop inference.

The tray reports inference state/context and measured generation speed. It does
not present Linux VM memory statistics as Mac hardware telemetry. Model weights
are external persistent data, never part of the app bundle.

## Test a checkout instead

Pull `fix/mac-virtgpu`, download the runtime artifact produced by the matching
commit, and extract the GitHub artifact ZIP. Keep the tarball and its `.sha256`
file beside one another. From the checkout:

```sh
./integrations/macos/install-runtime ~/Downloads/pain-macos-runtime-arm64.tar.gz
./integrations/macos/setup
./integrations/macos/ai add-model https://your-model-host/path/to/model.gguf
./integrations/macos/ai up llamacpp-metal
./integrations/macos/ai status
./integrations/macos/ai logs --once
./integrations/macos/ai down
```

`install-runtime` verifies the checksum and code signatures, checks host/guest
revisions, and refuses updates while `pain-metal` is running. For an upgrade,
stop inference, then run `CONTAINERS_MACHINE_PROVIDER=libkrun podman machine stop
pain-metal` before installing the new artifact. Previous runtime versions remain
available under the data directory; the installer only switches its `current`
symlink after validation. Do not run a checkout and packaged app against the same
machine simultaneously; both intentionally own the `pain-metal` VM.

The checkout installer defaults to `~/Library/Application Support/PAIN`.
`PAIN_DATA_DIR` overrides it. The Tauri app uses its own application-data directory
and passes that path to the same scripts. Neither writes global container config.

Keep checkout and model storage under your Mac home directory so Podman's host
sharing exposes them at the same absolute paths inside the VM. Optional settings:

- `PAIN_MODELS_DIR`: absolute Mac model directory (default `~/Models`).
- `PAIN_VM_CPUS`, `PAIN_VM_MEMORY`, `PAIN_VM_DISK`: creation-time settings (4,
  8192 MiB, 60 GiB). Existing machines are never silently resized/replaced.
- `PAIN_PODMAN_CONNECTION`: use this named Podman connection instead of the
  `pain-metal` VM's local API socket (the default, which avoids ssh).

The controller image contains Python and the Compose provider. It uses the
Podman VM socket to manage sibling containers, not nested virtualization. That
socket grants control over the dedicated VM's containers. The start script uses
a scoped helper-binary config to select the bundled krunkit wrapper. The wrapper
sets APIR loader variables immediately before exec, avoiding dependency on a
terminal's inherited DYLD settings.

APIR admits one guest process at a time. The Metal engine therefore serves one
model as a single llama-server process, not the router used by other llama.cpp
backends: the first `local-*` preset in `models.ini`, otherwise the first preset.
`ai up llamacpp-metal` stops a running engine before probing.

The APIR stack still uses upstream's Venus-capset routing workaround. This
machine therefore isn't for ordinary Vulkan workloads. Although virglrenderer
links MoltenVK as a dependency, inference is admitted only when llama.cpp
enumerates a `[virtgpu] Metal…` device. Missing/incorrect libraries fail before
replacing the running engine. CPU and Vulkan are never silently called Metal.

## QA checklist

- Record macOS, chip, memory, Podman version and branch commit.
- Run `lsof -c krunkit.real` and verify private virglrenderer/Metal libraries load.
- Confirm ARM64 image architecture; no x86 emulation should be involved.
- Start with a small GGUF. Require a remoted Metal device, model-load/offload logs,
  and a completed `/v1/chat/completions` response on localhost:11434.
- Exercise downloads, start, stop, restart, bounded logs, menu-bar reopen, and
  model persistence across VM restart. No inference server should appear on the host.
- Check missing runtime, checksum mismatch, and unsupported-device errors.
- Record prompt/generation speed and memory before large Q8, long-context or
  speculative-decoding experiments. Upstream documents a libkrun RAM+VRAM
  addressing limit of 64 GiB; verify the exact installed stack before large runs.
- `ai run` and `ai bench` remain Ollama-specific; use the OpenAI-compatible API
  for llama.cpp generation and comparison.

## Building the distribution

The GitHub workflow `.github/workflows/macos-qa.yml` builds the pinned APIR branch
and matching host/guest llama.cpp revision, recursively collects non-system
Mach-O dependencies, rewrites loader paths, verifies no Homebrew/build paths
remain, and ad-hoc signs the copies. Build prerequisites are installed only on
CI. `integrations/macos/build-runtime` is the equivalent developer-Mac entry
point. Then run `npm --prefix desktop ci`, `npm --prefix desktop run stage`, and
`npm --prefix desktop run tauri build -- --target aarch64-apple-darwin`.

Sources: [llama.cpp VirtGPU](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/VirtGPU.md),
[APIR Mac renderer](https://gitlab.freedesktop.org/kpouget/virglrenderer/-/tree/main-macos).

## UI stories and checks

`desktop/` contains the Tauri view and Storybook. The web view uses generated
exports of Omarchy's `Model.js`, and both renderer catalogs consume shared JSON
fixtures. Tauri stories are interactive; Omarchy stories show native QML captures
of the actual Widget.qml panel markup using installed Omarchy components. They
are not a browser imitation, but do not test native popup placement or IPC.
Regenerate captures on Omarchy with `python scripts/render-omarchy.py`.

```sh
npm --prefix desktop ci
npm --prefix desktop run build
npm --prefix desktop run build-storybook
python -m unittest discover -s tests -v
```

In this workspace, start Storybook through the shared preview manager:
`node ~/Projects/satoramoto/zen-flow/herdr/scripts/previews.mjs ensure pain-desktop`.
Then `cd desktop && npm run check:stories` checks both catalogs with Playwright's
own headless Chromium. For a plain checkout elsewhere, `npm run storybook`
serves it on port 6016. Linux Tauri distribution is deliberately not configured.

## Getting Started in the app

On first launch, PAIN opens **Getting Started**. Reopen it with **Help → Getting
Started**, the tray menu, or the dashboard button. **Set up my Mac** runs the
whole default sequence: install/reuse Podman, unpack the private APIR runtime,
boot the VM, download Qwen3 4B Q4_K_M (about 2.5 GB), start llama.cpp, and
install/reuse OpenCode. A failed step stops the sequence; **Retry this step**
keeps completed steps in the current session. Reopening the app safely reruns
checks and reuses downloaded weights and installed tools.

The default Podman VM uses 4 CPUs, 8 GB RAM and a 60 GB expandable disk. Allow
several GB of downloads. The official Podman installer is pinned to 6.2.0 and
checked against its release SHA-256 before macOS installs it; macOS may ask for
an administrator password. Metal/APIR remains experimental and needs hardware QA.
No host Homebrew, Node or Python installation is required.

**Docker Desktop** is an alternative for CPU inference. Setup downloads the
Apple Silicon Docker app if missing, verifies it with Gatekeeper, then opens
Docker Desktop. Accept its license and finish its first-run prompts. PAIN uses
the explicit `desktop-linux` context without changing Docker's global context.
The controller runs in a sibling container and accesses the Docker socket.
Stop the current engine before choosing a different framework.

OpenCode is reused when found on the application PATH; otherwise its official
Apple Silicon binary is installed in PAIN's private data directory. Both V1 and
V2 configuration formats are supported. **Open OpenCode** opens Terminal using
PAIN's `OpenCode.command` launcher. It injects a private `opencode.json` through
`OPENCODE_CONFIG`, selecting the local provider. Your global config, credentials
and normal `opencode` invocation are unchanged. This launcher starts in your
home directory; navigate to your project when using OpenCode.

### Onboarding QA

- Fresh Apple Silicon Mac: accept defaults, approve the macOS installer prompt,
  and verify all five steps finish and OpenCode can generate using PAIN.
- Existing Podman/OpenCode: verify setup reuses them and leaves global configs
  intact. Cancel an installation or interrupt a download, then retry.
- Docker: complete first-run prompts, verify CPU inference, stop it, and switch
  back to Podman. Check Help and tray Getting Started both reopen the screen.
- Run `npm --prefix desktop run test:stories -- --no-browser` for the virtual DOM
  plays, and `-- --browser-all` against the shared preview for all renderers.
  `check:stories` also captures the screen at 460 px and checks overflow.

## Signing on GitHub Actions

The Mac QA workflow follows OpenFlow's Tauri template
(`openflowfm/visuals/.github/workflows/release.yml`). Add these repository secrets
in **satoramoto/pain → Settings → Secrets and variables → Actions**:

| Secret | Value from OpenFlow |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64 Developer ID Application `.p12`, including its private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_API_KEY_P8` | Base64 App Store Connect API `.p8` key |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

The certificate is imported into a temporary runner keychain. The bundled
Mach-O libraries and VM helper are signed with the same identity as the app;
the helper retains its hypervisor entitlement. The runtime is submitted
separately for notarization because it is extracted outside the app. Tauri
signs/notarizes the app; CI also signs, notarizes and staples the DMG and checks
both app and image with Gatekeeper. Credentials are removed in an `always()` step.

Pushes use signing once all five secrets are set. With no secrets, artifacts
are explicitly named `*-unsigned`; partially configured signing fails. Manual
Mac QA runs default to requiring signing, so missing secrets fail instead of
silently producing unsigned software. No Tauri updater key is needed: this
workflow distributes the DMG, without an automatic updater.

After copying the secrets, rerun the latest Mac QA run on `fix/mac-virtgpu`.
Once this workflow is on the default branch, manual dispatch is also available
with `signed=true`.
The signed path still needs its first successful remote run with your credentials.
