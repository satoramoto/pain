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
    snap = dict(server, backend=backend, backends=list(ai['BACKENDS']),
                endpoint=f'http://127.0.0.1:{port}', memory=memory, hardware=hardware)
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
    args = ['notify-send', '-a', 'PAIN', '-u', 'critical' if urgent else 'normal', summary, body]
    try:
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass


def action(command, backend=None, escalate='sudo'):
    """Run an ai command, prefixing `escalate` when Docker needs elevated access."""
    ai = runpy.run_path(str(ROOT / 'ai'))
    if command == 'up' and backend not in ai['BACKENDS']:
        raise ValueError('Choose a supported backend')
    # Serialize starts/stops across terminals, widgets, and shell reloads.
    lock_path = ROOT / '.state' / 'desktop.lock'
    lock_path.parent.mkdir(exist_ok=True)
    with lock_path.open('a') as lock:
        if command in ('up', 'down'):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('A PAIN desktop start/stop is already in progress.')
        args = [str(ROOT / 'ai'), command]
        if command == 'up':
            args.append(backend)
        if command != 'top':
            runtime = ai['runtime']()
            probe = subprocess.run([runtime, 'info'], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10)
            if probe.returncode and runtime == 'podman':
                raise ValueError('Podman is unavailable. Start its machine/service; PAIN will not switch to rootful Podman.')
            if probe.returncode:
                args.insert(0, escalate)
        return subprocess.run(args, cwd=ROOT).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'up', 'down', 'logs', 'top'])
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
        print(f'PAIN: {exc}', file=sys.stderr)
        result = 1
    if interactive:
        if args.command in ('up', 'down') or result:
            try:
                input('\nPress Enter to close…')
            except (EOFError, KeyboardInterrupt):
                pass
    elif args.command in ('up', 'down'):
        target = args.backend or 'engine'
        if result:
            notify('PAIN engine', f'Could not {args.command} {target}: {error or f"exit {result}"}', urgent=True)
        else:
            notify('PAIN engine', f'{target} started' if args.command == 'up' else 'Engine stopped')
    return result


if __name__ == '__main__':
    sys.exit(main())
