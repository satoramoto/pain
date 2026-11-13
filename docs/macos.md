# pain(less) for Mac

You’ll need an **Apple Silicon Mac** (M1 or newer), **macOS 15 or later**, and
space for the models you choose. A model download can be several gigabytes.

## Install

1. Download the **Apple Silicon DMG** from [Releases](https://github.com/satoramoto/pain/releases).
   Choose a release marked signed and notarized.
2. Open the DMG and drag **pain(less)** into **Applications**.
3. Open the app. **Getting Started** walks you through the local runtime,
   your first model, and connecting OpenCode. Keep the default choices unless
   you already use Docker Desktop.

If there’s no signed release listed yet, don’t use a development build as a
substitute. The download link will be added when signing is complete.

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
