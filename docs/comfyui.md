# Make images with ComfyUI

ComfyUI is the image workspace used by pain(less) on supported Linux AMD and
NVIDIA GPUs. Starting it replaces the running coding engine; you can switch back
with the same dropdown.

1. Choose **ComfyUI** from the arrow beside **Start**, then press **Start**.
2. Click the address shown in pain(less) to open ComfyUI in your browser.
3. Choose a template. If it needs models, press its **Download** buttons.
   Downloads go straight into the right model folders; progress appears in the
   lower-left corner. You don’t need to move the files yourself.
4. When the downloads finish, refresh the model lists if needed and run the workflow.

## Where are my files?

| File | On your computer | Inside the container |
| --- | --- | --- |
| Models | `~/Models/comfyui` | `/data/models` |
| Generated images | `~/.local/share/pain/comfyui/output` | `/data/output` |
| Workflows and settings | `~/.local/share/pain/comfyui/user` | `/data/user` |

Models go into subfolders such as `diffusion_models`, `text_encoders`, `vae`, and
`loras`. ComfyUI itself is installed at `/opt/ComfyUI` inside the container;
put models in the folders above, not alongside its program files.

Open **Downloads** in ComfyUI’s lower-left corner to manage transfers, even
after reloading the page. **Cancel** stops a transfer and keeps its partial file.
**Resume** continues it; **Remove partial** asks before deleting that unfinished
file. Downloads run one at a time. Existing complete models are never overwritten.

The downloader supports public Hugging Face and Civitai model links. If a model
requires an account or license acceptance, download it from the provider and
place it in the matching subfolder yourself. Browser sign-in isn’t passed to
the container.

Already have this page open after an update? Reload ComfyUI to pick up the
Download-button integration.

[GPU requirements and configuration](comfyui-reference.md)
