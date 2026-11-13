#!/usr/bin/env python3
"""Stage a Tauri update and manifest; publish only from a matching stable tag."""
import datetime
import json
import os
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parents[2]
config = json.loads((root / 'desktop/src-tauri/tauri.conf.json').read_text())
version = config['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('Stable updates require an X.Y.Z app version')
tag = f'v{version}'
if os.environ.get('GITHUB_REF_TYPE') == 'tag' and os.environ.get('GITHUB_REF_NAME') != tag:
    raise SystemExit('Release tag must match the version in tauri.conf.json')
bundles = list((root / 'desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos').glob('*.app.tar.gz'))
if len(bundles) != 1:
    raise SystemExit('Expected exactly one Tauri updater archive')
bundle = bundles[0]
signature = bundle.with_name(bundle.name + '.sig').read_text().strip()
if not signature:
    raise SystemExit('Updater signature is missing')
out = root / '.build/update'
out.mkdir(parents=True, exist_ok=True)
name = f'PAIN_{version}_aarch64.app.tar.gz'
shutil.copyfile(bundle, out / name)
(out / (name + '.sig')).write_text(signature + '\n')
repo = 'https://github.com/satoramoto/pain'
(out / 'latest.json').write_text(json.dumps({
    'version': version,
    'notes': f'Release notes: {repo}/releases/tag/{tag}',
    'pub_date': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'platforms': {'darwin-aarch64': {
        'signature': signature,
        'url': f'{repo}/releases/download/{tag}/{name}',
    }},
}, indent=2) + '\n')
print(f'Staged signed update for {tag}')
