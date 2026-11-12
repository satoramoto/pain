#!/usr/bin/env python3
"""Copy the Mach-O dependency closure, rewrite loader paths, then sign for distribution (or ad-hoc QA).

Build-machine tool only; the installed runtime does not need Python or Homebrew.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess


def output(*args):
    return subprocess.check_output(args, text=True)


def dependencies(binary):
    return [line.strip().split(' (compatibility version', 1)[0]
            for line in output('otool', '-L', str(binary)).splitlines()[1:]]


def system_library(name):
    return name.startswith(('/System/Library/', '/usr/lib/'))


def resolve(name, origin, search):
    if name.startswith('@loader_path/'):
        candidates = [origin.parent / name.removeprefix('@loader_path/')]
    elif name.startswith('@rpath/') or name.startswith('@executable_path/'):
        relative = name.split('/', 1)[1]
        candidates = [origin.parent / relative, *[p / relative for p in search]]
        lines = output('otool', '-l', str(origin)).splitlines()
        for i, line in enumerate(lines):
            if line.strip() == 'cmd LC_RPATH':
                path = lines[i + 2].strip().split('path ', 1)[1].split(' (offset', 1)[0]
                path = path.replace('@loader_path', str(origin.parent))
                candidates.append(Path(path) / relative)
    else:
        candidates = [Path(name), *[p / Path(name).name for p in search]]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(f'Unresolved dependency {name} in {origin}')


def bundle(destination, seeds, search, virgl, entitlements):
    destination.mkdir(parents=True, exist_ok=False)
    (destination / 'lib').mkdir()
    (destination / 'libexec').mkdir()
    copied, pending, origins = {}, [], {}

    def add(source, target):
        source = source.resolve()
        if target in copied:
            if copied[target] != source:
                raise RuntimeError(f'Conflicting library basename: {target}')
            return
        if 'arm64' not in output('lipo', '-archs', str(source)).split():
            raise RuntimeError(f'Not an ARM64 binary: {source}')
        dest = destination / target
        shutil.copy2(source, dest)
        dest.chmod(0o755)
        copied[target] = source
        pending.append((source, target))
        origins[str(target)] = str(source)

    for source, target in seeds:
        add(source, target)
    while pending:
        source, target = pending.pop()
        dest = destination / target
        for dep in dependencies(source):
            if system_library(dep):
                continue
            # Use the patched renderer even when libkrun links the stock copy.
            if Path(dep).name.startswith('libvirglrenderer'):
                resolved = virgl.resolve()
            else:
                resolved = resolve(dep, source, search)
            dep_target = Path('lib') / Path(dep).name
            add(resolved, dep_target)
            relative = '@loader_path/' + ('../lib/' if target.parent.name == 'libexec' else '') + dep_target.name
            subprocess.run(['install_name_tool', '-change', dep, relative, str(dest)], check=True)
        if target.suffix == '.dylib' and source.suffix != '.so':
            subprocess.run(['install_name_tool', '-id', '@loader_path/' + target.name, str(dest)], check=True)
    # Reject any dependency on the builder's Homebrew or checkout.
    for target in copied:
        for dep in dependencies(destination / target):
            if not system_library(dep) and not dep.startswith('@loader_path/'):
                raise RuntimeError(f'Nonportable dependency {dep} in {target}')
        identity = os.environ.get('APPLE_SIGNING_IDENTITY') or '-'
        command = ['codesign', '--force', '--sign', identity]
        if identity != '-':
            command += ['--timestamp', '--options', 'runtime']
        if target.name == 'krunkit.real':
            command += ['--entitlements', str(entitlements)]
        subprocess.run([*command, str(destination / target)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(destination / target)], check=True)
    (destination / 'build-origins.json').write_text(json.dumps(origins, indent=2) + '\n')


def metal_seeds(directory):
    # Preserve library filenames including aliases needed by dlopen.
    seeds = [(p, Path('lib') / p.name) for p in directory.glob('*.dylib')]
    # CMake MODULE targets are Mach-O .so files even on macOS. APIR's
    # explicit library paths use stable .dylib names; keep the .so aliases too.
    for name in ('ggml-metal', 'ggml-virtgpu-backend'):
        dylib = directory / f'lib{name}.dylib'
        module = directory / f'lib{name}.so'
        if not dylib.exists():
            if not module.exists():
                raise RuntimeError(f'Missing required runtime module: {name}')
            seeds += [(module, Path('lib') / module.name),
                      (module, Path('lib') / dylib.name)]
    return seeds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metal', type=Path, required=True)
    parser.add_argument('--virgl', type=Path, required=True)
    parser.add_argument('--krunkit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    seeds = [(args.krunkit, Path('libexec/krunkit.real')),
             (args.virgl, Path('lib/libvirglrenderer.1.dylib'))]
    seeds += metal_seeds(args.metal)
    # libkrun opens its guest kernel library by bare name at run time, so
    # otool never lists it; without a copy a Mac without Homebrew cannot boot.
    firmware_libraries = sorted(Path('/opt/homebrew/lib').glob('libkrunfw.[0-9]*.dylib'))
    if not firmware_libraries:
        raise RuntimeError('Missing libkrunfw in /opt/homebrew/lib')
    seeds += [(p, Path('lib') / p.name) for p in firmware_libraries]
    bundle(args.output, seeds, [args.metal, args.virgl.parent, Path('/opt/homebrew/lib')],
           args.virgl, root / 'integrations/macos/krunkit-entitlements.plist')
    shutil.copy2(root / 'containers/virtgpu/llama-revision', args.output / 'llama-revision')
    shutil.copy2(root / 'integrations/macos/virgl-revision', args.output / 'virgl-revision')
    # krunkit locates its EFI firmware relative to its own executable.
    firmware = args.krunkit.resolve().parents[1] / 'share/krunkit/KRUN_EFI.silent.fd'
    (args.output / 'share/krunkit').mkdir(parents=True)
    shutil.copy2(firmware, args.output / 'share/krunkit/KRUN_EFI.silent.fd')
    (args.output / 'bin').mkdir()
    shutil.copy2(root / 'integrations/macos/krunkit-wrapper', args.output / 'bin/krunkit')
    (args.output / 'bin/krunkit').chmod(0o755)


if __name__ == '__main__':
    main()
