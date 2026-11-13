# pain(less) for Mac

You’ll need an **Apple Silicon Mac** (M1 or newer), **macOS 15 or later**, and
space for the models you choose. A model download can be several gigabytes.

## Install

1. [Download pain(less) for Apple Silicon](https://github.com/satoramoto/pain/releases/download/v0.1.0/pain.less._0.1.0_aarch64.dmg).
   This installer is Developer ID signed and Apple-notarized.
2. Open the DMG and drag **pain(less)** into **Applications**.
3. Open the app. **Getting Started** walks you through the local runtime,
   your first model, and connecting OpenCode. Keep the default choices unless
   you already use Docker Desktop.

## Everyday use

- Open pain(less) from the menu bar.
- Use **Models** to download or choose a model, then press **Start**.
- Use **Stop** when you want the memory back.
- Open **?** to revisit setup, or **Logs** if the engine won’t start.
- **Help → Check for Updates…** checks for a newer release.

Closing the app window keeps the engine running. Your models stay on your Mac;
removing or updating the app does not remove them. Image generation through
ComfyUI is currently Linux-only.

For build instructions or troubleshooting the runtime, see the
[Mac technical reference](macos-development.md).
