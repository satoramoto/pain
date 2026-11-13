"""Linux ComfyUI selection and HTTP API; no Docker or filesystem mutations on import."""
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import urllib.request

BACKENDS = ('comfyui-rocm', 'comfyui-cuda')
# PCI ID of Strix Halo's integrated GPU. Do not force gfx1151 onto other AMD GPUs.
STRIX_HALO = '0x1586'


def choices():
    return ('comfyui', *BACKENDS) if platform.system() == 'Linux' else ()


def inventory(pci_root=Path('/sys/bus/pci/devices')):
    """Read PCI devices, including NVIDIA cards without DRM KMS enabled."""
    found = []
    for path in sorted(pci_root.glob('*')):
        try:
            kind = int((path / 'class').read_text().strip(), 16) >> 16
            vendor = (path / 'vendor').read_text().strip().lower()
            device = (path / 'device').read_text().strip().lower()
        except (OSError, ValueError):
            continue
        if kind not in (0x03, 0x12):
            continue
        if vendor in ('0x1002', '0x10de'):
            found.append({'vendor': 'amd' if vendor == '0x1002' else 'nvidia',
                          'device': device, 'pci': path.name})
    return found


def resolve(name, device=None):
    if name not in ('comfyui', *BACKENDS):
        if device:
            raise ValueError('--device applies only to the comfyui backend.')
        return name
    if platform.system() != 'Linux':
        raise ValueError('ComfyUI GPU containers are available on Linux only; macOS is not supported.')
    if name in BACKENDS:
        if device and name != f'comfyui-{device}':
            raise ValueError('The backend and --device disagree.')
        return name
    if device:
        return f'comfyui-{device}'
    vendors = {gpu['vendor'] for gpu in inventory()}
    if len(vendors) > 1:
        raise ValueError('AMD and NVIDIA GPUs detected. Choose ./ai up comfyui --device rocm or --device cuda.')
    if not vendors:
        raise ValueError('No AMD or NVIDIA GPU detected. ComfyUI requires a supported Linux GPU; no CPU fallback is selected.')
    return 'comfyui-rocm' if 'amd' in vendors else 'comfyui-cuda'


def check_host(selected, cfg):
    """Cheap failures before pulling or disturbing the currently running engine."""
    gpus = inventory()
    vendor = 'amd' if selected == 'comfyui-rocm' else 'nvidia'
    matching = [g for g in gpus if g['vendor'] == vendor]
    if not matching:
        raise ValueError(f'No {vendor.upper()} GPU detected for {selected}.')
    if selected == 'comfyui-rocm':
        if not Path('/dev/kfd').exists() or not list(Path('/dev/dri').glob('renderD*')):
            raise ValueError('ROCm requires /dev/kfd and /dev/dri/renderD*. Check the host AMD driver.')
        if not cfg.get('PAIN_COMFYUI_ROCM_IMAGE') and any(g['device'] != STRIX_HALO for g in matching):
            raise ValueError('The bundled ROCm image targets Strix Halo (gfx1151). '
                             'Set PAIN_COMFYUI_ROCM_IMAGE to a compatible image for this AMD GPU; see docs/comfyui.md.')


def environment(cfg):
    env = dict(cfg)
    home = Path(pwd.getpwuid(int(cfg['SUDO_UID'])).pw_dir) if cfg.get('SUDO_UID') else Path.home()
    data = Path(cfg.get('PAIN_COMFYUI_DATA_DIR', home / '.local/share/pain/comfyui')).expanduser()
    if not data.is_absolute():
        raise ValueError('PAIN_COMFYUI_DATA_DIR must be an absolute path.')
    models = Path(cfg.get('PAIN_COMFYUI_MODELS_DIR', home / 'Models/comfyui')).expanduser()
    if not models.is_absolute():
        raise ValueError('PAIN_COMFYUI_MODELS_DIR must be an absolute path.')
    env['PAIN_COMFYUI_MODELS_DIR'] = str(models)
    env['PAIN_COMFYUI_DATA_DIR'] = str(data)
    env['PAIN_COMFYUI_UID'] = cfg.get('PAIN_COMFYUI_UID', cfg.get('SUDO_UID', str(os.getuid())))
    env['PAIN_COMFYUI_GID'] = cfg.get('PAIN_COMFYUI_GID', cfg.get('SUDO_GID', str(os.getgid())))
    return env


def url(cfg):
    port = int(cfg.get('PAIN_COMFYUI_PORT', '8188'))
    if not 0 < port <= 65535:
        raise ValueError('PAIN_COMFYUI_PORT must be between 1 and 65535.')
    return f'http://127.0.0.1:{port}'


def api(cfg, path='system_stats', timeout=3):
    with urllib.request.urlopen(f'{url(cfg)}/{path}', timeout=timeout) as response:
        return json.load(response)


def validate_stats(stats):
    # A responding HTTP server is not proof that ComfyUI is using the GPU.
    if not isinstance(stats, dict) or not isinstance(stats.get('devices'), list):
        raise ValueError('Invalid ComfyUI system_stats response.')
    if not stats['devices'] or not isinstance(stats['devices'][0], dict) or stats['devices'][0].get('type') != 'cuda':
        # PyTorch reports both ROCm and NVIDIA through its cuda device API.
        raise ValueError('ComfyUI is not using a GPU. Inspect ./ai logs.')


def probe_code(selected):
    expected_hip = selected == 'comfyui-rocm'
    return (
        'import torch; '
        f'assert bool(torch.version.hip) == {expected_hip!r}, "Wrong PyTorch GPU build"; '
        'assert torch.cuda.is_available(), "GPU unavailable: check driver and container GPU access"; '
        'x=torch.ones((32,32),device="cuda"); '
        'assert (x@x)[0,0].item()==32; '
        'print("GPU probe passed:",torch.cuda.get_device_name(0))'
    )


def prepare_workspace(cfg, migrate=True):
    """Move the old model tree without overwriting weights in the new mount."""
    env = environment(cfg)
    target = Path(env['PAIN_COMFYUI_MODELS_DIR'])
    source = Path(env['PAIN_COMFYUI_DATA_DIR']) / 'models'
    created = []
    parent = target
    while not parent.exists():
        created.append(parent)
        parent = parent.parent
    if source.resolve() != target.resolve() and (source.resolve().is_relative_to(target.resolve()) or target.resolve().is_relative_to(source.resolve())):
        raise ValueError('The old and new model folders must not be nested inside each other.')
    if migrate and source.resolve() != target.resolve() and source.exists():
        entries = list(source.rglob('*'))
        for old in entries:
            new = target / old.relative_to(source)
            if old.is_symlink() or (new.exists() and not (old.is_dir() and new.is_dir())):
                raise ValueError(f'Model migration needs attention: {old} -> {new}. No files were moved.')
        target.mkdir(parents=True, exist_ok=True)
        for old in sorted(entries, key=lambda p: len(p.parts)):
            new = target / old.relative_to(source)
            if old.is_dir():
                new.mkdir(parents=True, exist_ok=True)
            else:
                shutil.move(str(old), str(new))
    else:
        target.mkdir(parents=True, exist_ok=True)
    if os.geteuid() == 0:
        uid, gid = int(env['PAIN_COMFYUI_UID']), int(env['PAIN_COMFYUI_GID'])
        for folder in [target, *created]:
            os.chown(folder, uid, gid)
        for folder in target.rglob('*'):
            if folder.is_dir():
                os.chown(folder, uid, gid)
    return env
