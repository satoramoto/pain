#!/usr/bin/env python3
"""Small desktop adapter; always executes code from the linked checkout."""
import argparse
import fcntl
import json
from pathlib import Path
import runpy
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]


def summarize_inference(server):
    """Flatten the live slot the same way paintop picks it: the busy one, else the first."""
    slots = server.get('slots') or []
    active = None
    for slot in slots:
        if isinstance(slot, dict) and slot.get('is_processing'):
            active = slot
            break
    if active is None and slots and isinstance(slots[0], dict):
        active = slots[0]
    if active is None:
        return {'has_slot': False, 'processing': False, 'speculative': False, 'n_ctx': 0,
                'prompt': 0, 'cached': 0, 'decoded': 0, 'remain': 0, 'cache_hit_pct': None}
    next_tok = (active.get('next_token') or [{}])[0] or {}
    prompt = int(active.get('n_prompt_tokens') or 0)
    cached = int(active.get('n_prompt_tokens_cache') or 0)
    return {
        'has_slot': True,
        'processing': bool(active.get('is_processing', False)),
        'speculative': bool(active.get('speculative', False)),
        'n_ctx': int(active.get('n_ctx') or 0),
        'prompt': prompt,
        'cached': cached,
        'decoded': int(next_tok.get('n_decoded') or 0),
        'remain': int(next_tok.get('n_remain') or 0),
        'cache_hit_pct': int(round(cached / prompt * 100)) if prompt > 0 else None,
    }


def snapshot():
    ai = runpy.run_path(str(ROOT / 'ai'))
    top = runpy.run_path(str(ROOT / 'paintop'))
    port = int(ai['config']().get('PAIN_PORT', '11434'))
    server = top['fetch_server_stats'](port)
    memory = top['get_system_mem']()
    hardware = top['get_hwmon']()
    backend = ai['backend']()
    comfy = ai['comfy_backend']
    vendors = {gpu['vendor'] for gpu in comfy.inventory()}
    backends = [name for name in ai['LLM_BACKENDS'] if name != 'llamacpp-metal'] + [name for name, vendor in [('comfyui-rocm', 'amd'), ('comfyui-cuda', 'nvidia')] if vendor in vendors]
    if backend in comfy.BACKENDS:
        try:
            comfy.validate_stats(comfy.api(ai['config']()))
            server = {'online': True, 'engine': 'ComfyUI'}
        except Exception:
            server = {'online': False, 'engine': 'ComfyUI'}
    snap = dict(server, backend=backend, backends=backends, modelsDir=str(ai['models_dir']()), telemetry_scope='linux-host',
                endpoint=comfy.url(ai['config']()) if backend in comfy.BACKENDS else f'http://127.0.0.1:{port}', memory=memory, hardware=hardware)
    snap['models'] = ai['model_catalog']()
    snap['swap'] = top['get_swap_info']() if 'get_swap_info' in top else {}
    inference = summarize_inference(server)
    snap['inference'] = inference
    if 'split_memory' in top:
        # Same split paintop draws: measured GTT = weights + draft + KV/compute, rest is Sys.
        name = str(server.get('model_alias') or '').lower()
        weights = next((gib for key, gib in top['MODEL_WEIGHTS_GIB'] if key in name), top['DEFAULT_WEIGHTS_GIB'])
        if not server.get('model_alias'):
            weights = 0.0
        speculative = inference['speculative'] or backend.startswith('llamacpp')
        draft = top['DRAFT_WEIGHTS_GIB'] if (speculative and server.get('model_alias')) else 0.0
        snap['memory_split'] = top['split_memory'](
            memory.get('used_gib', 0.0), hardware.get('gtt_used_gib', 0.0), hardware.get('gtt_total_gib', 0.0),
            memory.get('total_gib', 0.0), weights, draft)
    return snap


def notify(summary, body, urgent=False):
    """Desktop notification for background runs; silently skipped without notify-send."""
    args = ['notify-send', '-a', 'pain(less)', '-u', 'critical' if urgent else 'normal', summary, body]
    try:
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass


def action(command, backend=None, escalate='sudo'):
    """Run an ai command, prefixing `escalate` when Docker needs elevated access."""
    ai = runpy.run_path(str(ROOT / 'ai'))
    if command == 'up' and backend not in ai['BACKENDS']:
        raise ValueError('Choose a supported backend')
    if command in ('pull', 'use', 'remove') and backend not in ai['presets']():
        raise ValueError('Choose a known model preset')
    if command == 'download' and (not backend or not backend.startswith('https://')):
        raise ValueError('Use an HTTPS GGUF download URL.')
    folder = None
    if command == 'folder':
        folder = Path(backend or '').expanduser().resolve()
        if not folder.is_relative_to(Path.home().resolve()) or any(c in str(folder) for c in '\n\r\"\''):
            raise ValueError('Choose a folder inside your home folder.')
    # Serialize model changes and starts/stops across desktop surfaces.
    lock_path = ROOT / '.state' / 'desktop.lock'
    lock_path.parent.mkdir(exist_ok=True)
    with lock_path.open('a') as lock:
        if command in ('up', 'down', 'pull', 'use', 'remove', 'download', 'folder'):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('A pain(less) desktop operation is already in progress.')
        args = [str(ROOT / 'ai'), 'add-model' if command == 'download' else 'down' if command == 'folder' else command]
        if command == 'logs':
            args.append('--once')
        if command == 'download':
            args.append(backend)
        if command in ('up', 'pull', 'use', 'remove'):
            args.append(backend)
        if command == 'remove':
            # Desktop callers show the confirmation before invoking the bridge.
            args.append('--yes')
        prefix = []
        if command not in ('top', 'pull', 'remove', 'download'):
            runtime = ai['runtime']()
            probe = subprocess.run([runtime, 'info'], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10)
            if probe.returncode and runtime == 'podman':
                raise ValueError('Podman is unavailable. Start its machine/service; pain(less) will not switch to rootful Podman.')
            if probe.returncode:
                prefix = [escalate]
        result = subprocess.run(prefix + args, cwd=ROOT).returncode
        if result == 0 and command == 'folder':
            folder.mkdir(parents=True, exist_ok=True)
            env_file = ROOT / '.env'
            lines = env_file.read_text().splitlines() if env_file.exists() else []
            lines = [line for line in lines if line.split('=', 1)[0].strip() != 'PAIN_MODELS_DIR']
            lines.append(f'PAIN_MODELS_DIR={folder}')
            temporary = env_file.with_suffix('.env.tmp')
            temporary.touch(mode=0o600, exist_ok=True)
            temporary.write_text('\n'.join(lines) + '\n')
            temporary.replace(env_file)
        if result == 0 and command == 'use':
            result = subprocess.run(prefix + [str(ROOT / 'ai'), 'up', ai['backend']()], cwd=ROOT).returncode
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'up', 'down', 'logs', 'top', 'pull', 'use', 'remove', 'download', 'folder'])
    parser.add_argument('backend', nargs='?')
    args = parser.parse_args()
    if args.command == 'status':
        try:
            print(json.dumps(snapshot()))
        except Exception as exc:
            print(json.dumps({'online': False, 'error': str(exc)}))
        return 0
    # In a terminal, sudo can ask for a password and the window stays open with the
    # result. Launched from the panel (no tty) we escalate with pkexec and report
    # through a desktop notification instead of blocking on stdin.
    interactive = sys.stdin.isatty()
    error = ''
    try:
        result = action(args.command, args.backend, escalate='sudo' if interactive else 'pkexec')
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        error = str(exc)
        print(f'pain(less): {exc}', file=sys.stderr)
        result = 1
    if interactive:
        if args.command in ('up', 'down', 'pull', 'use', 'remove') or result:
            try:
                input('\nPress Enter to close…')
            except (EOFError, KeyboardInterrupt):
                pass
    elif args.command in ('up', 'down', 'pull', 'use', 'remove', 'download', 'folder'):
        target = args.backend or 'engine'
        title = 'pain(less) models' if args.command in ('pull', 'use', 'remove') else 'pain(less) engine'
        if result:
            notify(title, f'Could not {args.command} {target}: {error or f"exit {result}"}', urgent=True)
        else:
            message = {'up': f'{target} started', 'down': 'Engine stopped',
                       'pull': f'{target} downloaded', 'use': f'{target} selected; engine started',
                       'download': 'Model downloaded', 'folder': 'Models folder changed',
                       'remove': f'{target} local files removed'}[args.command]
            notify(title, message)
    return result


if __name__ == '__main__':
    sys.exit(main())
