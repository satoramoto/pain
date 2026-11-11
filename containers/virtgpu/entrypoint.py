"""Require a real remoted Metal device; never advertise CPU/Vulkan as Metal."""
import os
import re
import subprocess
import sys

SERVER = '/opt/llama/llama-server'


def metal_device(output):
    # Match a device row, not a startup log that merely mentions Metal support.
    for line in output.splitlines():
        match = re.match(r'^\s*(\[virtgpu\] Metal[^:]*):\s+(.+)$', line)
        if match:
            return match[1]
    raise ValueError('No VirtGPU Metal device enumerated. Configure the matching '
                     'APIR/ggml-metal host stack before starting the VM; see docs/macos.md.')


def main(args):
    result = subprocess.run([SERVER, '--list-devices'], capture_output=True, text=True, timeout=90)
    output = result.stdout + '\n' + result.stderr
    if result.returncode:
        raise ValueError('VirtGPU device probe failed:\n' + output)
    device = metal_device(output)
    print(f'PAIN: verified remoted Metal device {device}', flush=True)
    if args == ['--pain-probe']:
        return
    # An explicit device prevents automatic selection of a different accelerator.
    os.execv(SERVER, [SERVER, *args, '--device', device])


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f'PAIN: {exc}', file=sys.stderr)
        sys.exit(1)
