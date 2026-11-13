"""Require a real remoted Metal device; never advertise CPU/Vulkan as Metal."""
import os
import re
import subprocess
import sys

SERVER = '/opt/llama/llama-server'


def metal_device(output):
    # Match a device row, not a startup log that merely mentions Metal support.
    for line in output.splitlines():
        match = re.match(r'^\s*(\[virtgpu\] (?:Metal|MTL)[^:]*):\s+(.+)$', line)
        if match:
            return match[1]
    raise ValueError('No VirtGPU Metal device enumerated. Configure the matching '
                     'APIR/ggml-metal host stack before starting the VM; see docs/macos.md.')


def single_model(args):
    """Replace router flags with one preset's flags.

    APIR admits one guest process at a time, so the router (a parent plus one
    child server per model) can never load a model. Serve one preset directly.
    """
    if '--models-preset' not in args:
        return args
    args = list(args)
    at = args.index('--models-preset')
    path = args[at + 1]
    del args[at:at + 2]
    if '--models-max' in args:
        at = args.index('--models-max')
        del args[at:at + 2]
    args = [a for a in args if a != '--models-autoload']
    presets, current = {}, None
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if line.startswith('[') and line.endswith(']'):
                current = presets.setdefault(line[1:-1], [])
            elif current is not None and '=' in line:
                key, value = (part.strip() for part in line.split('=', 1))
                current += ['--' + key, value]
    try:
        with open(os.path.join(os.path.dirname(path), 'models.selected')) as handle:
            selected = handle.read().strip()
    except OSError:
        selected = ''
    name = selected if selected in presets else next(
        (n for n in presets if n.startswith('local-')), next(iter(presets), None))
    if name is None:
        raise ValueError('No model is downloaded yet. Download a model, then start again.')
    return [*args, '--alias', name, *presets[name]]


def main(args):
    result = subprocess.run([SERVER, '--list-devices'], capture_output=True, text=True, timeout=90)
    output = result.stdout + '\n' + result.stderr
    if result.returncode:
        raise ValueError('VirtGPU device probe failed:\n' + output)
    device = metal_device(output)
    print(f'PAIN: verified remoted Metal device {device}', flush=True)
    if args == ['--pain-probe']:
        return
    args = single_model(args)
    # An explicit device prevents automatic selection of a different accelerator.
    os.execv(SERVER, [SERVER, *args, '--device', device])


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f'PAIN: {exc}', file=sys.stderr)
        sys.exit(1)
