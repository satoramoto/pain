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
3. Open PAIN and follow **Getting Started** to prepare the private runtime, VM
   and starter model. The first setup requires internet access for the Linux
   image, model and containers.
4. Open **Models** to download another supported preset or add an HTTPS GGUF
   URL. Choose **Use** to start a downloaded model. Models are stored in
   `~/Models` unless you change the folder in the model manager.
5. Use the menu-bar PAIN entry to reopen the window. Closing the window hides it;
   quitting the UI keeps inference running. Use **Stop** to stop inference.

The tray reports inference state/context and measured generation speed. A native
Mac adapter reads host RAM, swap, CPU tick deltas and driver-exposed GPU usage.
CPU is unavailable until two samples exist. Power, temperatures and Linux GTT
remain unavailable; Linux VM statistics are not substituted. Model weights
are external persistent data, never part of the app bundle.

The **Dashboard** and **Models** tabs share a pinned, aligned action toolbar.
Mac uses Visual Flow's Zen theme, separated glass section surfaces and native
macOS HUD-window vibrancy. Linux renders the same view through Zen’s QML application binding.

The separate **Models** view shows supported presets, download sizes and local
availability. Use **Download** or **Resume** to fetch a preset and **Use** to
start it. **Remove** asks for confirmation before removing its local weights and
partial downloads; stop inference first. Files shared with another preset or
linked outside normal model storage are protected. Preset definitions remain so
removed downloads can be fetched again.

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

- `PAIN_MODELS_DIR`: absolute Mac model directory (default `~/Models`). The desktop app sets it from
  its **Models folder** field, which accepts folders inside your home folder only, since the VM shares
  just `/Users` with the Mac.
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

### Rebuild and install for local QA

With the runtime tarball and checksum already in `.build`, run this from the
checkout you want to try:

```sh
./integrations/macos/rebuild-install
```

The script verifies the cached runtime, installs JavaScript dependencies if
missing, stages the current controller sources, and builds the Apple Silicon
app with an ad-hoc signature for local QA. It quits the old PAIN window/tray and replaces `/Applications/PAIN.app`
only after the new bundle passes signature verification. The VM, inference,
models and application settings stay in place. Open PAIN from Applications
when it finishes. It does not build a DMG or rebuild the Metal runtime.

An optional absolute destination is supported, for example
`./integrations/macos/rebuild-install "$HOME/Applications/PAIN.app"`.
Temporary installation files are cleaned from `~/.syns/scratch/pain/`; a failed
replacement restores the previous app when possible and reports any backup
that needs attention.

Sources: [llama.cpp VirtGPU](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/VirtGPU.md),
[APIR Mac renderer](https://gitlab.freedesktop.org/kpouget/virglrenderer/-/tree/main-macos).

## UI stories and checks

The Mac design is the reference. `integrations/omarchy/pain/App.mjs` defines
one application tree for the toolbar, tabs, dashboard, model manager, forms and
logs. `AppState.mjs` owns navigation and action guards. Zen supplies the generic
browser and QML application renderers, including heroes, surfaces and meters.
`Widget.qml` and `desktop/src/panel.tsx` are hosts; neither defines a dashboard.

Guided setup, model-folder selection and URL downloads stay outside the compact
dashboard. Platform adapters supply status and execute effects. The Linux host
adds its available backend choices through the shared view’s capability input.
Mac hardware readings come from Mach, sysctl and IOKit; unsupported sensors are
identified explicitly. Catalog capacity is separate from live memory readings.

`desktop/` contains the Tauri host and Storybook. Both renderer catalogs consume
shared JSON fixtures. Tauri stories are interactive; Omarchy stories show native
QML captures, which do not test native popup placement or IPC. Regenerate those
captures on Omarchy with `python scripts/render-omarchy.py`.

```sh
npm --prefix desktop ci
npm --prefix desktop run build
npm --prefix desktop run build-storybook
```

Atomic compile and test commands, and when to use them, are listed in
[`AGENTS.md`](../AGENTS.md). The full suite runs in CI.

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
silently producing unsigned software. QA builds also create signed updater
archives when the updater secret is configured; they do not publish releases.

After copying the secrets, rerun the latest Mac QA run on `fix/mac-virtgpu`.
Once this workflow is on the default branch, manual dispatch is also available
with `signed=true`.
The signed app, runtime and DMG passed remote signing, notarization and Gatekeeper
verification in run `43369465341`. Installation and inference still need Mac QA.


## App updates

Open **Help → Check for Updates…**, or right-click the brain in the menu bar
and choose **Check for Updates…**. PAIN checks the latest stable release on
`satoramoto/pain`. Select **Install and restart** to download, verify and install
it. No download or restart happens before that selection. Run PAIN from
`/Applications`, not directly from a mounted DMG.

The updater uses Tauri signature verification in addition to Apple's code
signing. Configure `TAURI_SIGNING_PRIVATE_KEY` and, for an encrypted key,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in GitHub Actions secrets. The matching
public key goes in the `TAURI_UPDATER_PUBLIC_KEY` GitHub Actions repository
variable. CI embeds it into the app through a Tauri config override. Local builds
without this override cannot verify or install updates; supply the same override
to test updates locally. Private keys never belong in the repository. Keep this key for future releases: changing only the public
key prevents existing installations from accepting updates.

To publish after Mac QA:

1. Bump the stable `X.Y.Z` version in `desktop/src-tauri/tauri.conf.json`,
   `desktop/src-tauri/Cargo.toml`, `desktop/package.json` and their lockfiles.
2. Commit and push the tested code, then tag that commit `vX.Y.Z` and push the tag.
3. Mac QA validates the tag/version match, requires both Apple signing and updater
   signing, and builds the app and DMG. It uploads the signed `.app.tar.gz`,
   `.sig`, `latest.json` and DMG to a draft GitHub release before publishing it.
   A failed upload leaves a draft; remove that draft before rerunning publication.

The feed is `https://github.com/satoramoto/pain/releases/latest/download/latest.json`.
Only `darwin-aarch64` is shipped. Before the first stable release, checking shows
an error with retry; QA workflow artifacts are not an update feed. A newer version
is required to offer an update, so rebuilding `0.1.0` does not update `0.1.0` users.

The app restarts independently of inference. Models, settings and VM data remain
in the user data directory. Bundled controller files refresh at launch; a changed
APIR runtime is installed by Getting Started after the dedicated VM is stopped.
App updates do not replace a running VM runtime; follow the runtime upgrade steps
above when a release changes APIR or llama.cpp.

For Mac QA, install the older signed app in Applications, publish a newer tested
version, check for updates, and install it. Verify the version changed, the app
reopens from the tray, and models/configuration survive. Also check offline/retry
and a failed download. CI verifies packaging; it cannot prove an installed Mac
can replace and restart its own app.
