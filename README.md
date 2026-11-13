# pain(less)

**Making agentic coding with local AI as painless as possible**

pain(less) is a small desktop app for running AI on your own computer.
Choose a model, start it, and connect a coding assistant. The app handles the
local engine and shows what it’s doing.

## Get started

- **Mac:** follow the [short installation guide](docs/macos.md). Requires an
  Apple Silicon Mac running macOS 15 or later.
- **Linux:** use the Omarchy panel with an AMD or NVIDIA GPU. See the
  [Linux setup reference](docs/reference.md#quick-start).

In the app, **?** opens setup help. **Models** is where you download and select
a coding model. **Start** runs it; **Stop** frees the memory it was using.
**Logs** helps when something goes wrong.

OpenCode can connect to the local engine to work on your code. Models vary in
speed, memory use, and ability—start with one that fits your computer.
Downloading models needs internet access; local inference runs on your machine.

## Images, too

On supported Linux GPUs, choose ComfyUI from the arrow beside **Start**.
Click its address to open the image workspace. See [the image guide](docs/comfyui.md)
for downloading models and finding your files. Image generation isn’t offered
on Mac yet.

## Need more detail?

[Commands and configuration](docs/reference.md) ·
[Mac development](docs/macos-development.md) ·
[ComfyUI technical details](docs/comfyui-reference.md)

The app is called **pain(less)**. Existing commands, `PAIN_*` settings, and data
folders keep their names, so older setups continue to work.
