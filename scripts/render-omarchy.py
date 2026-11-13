#!/usr/bin/env python3
"""Capture the same App.mjs tree and Zen QML renderer used by Widget.qml."""
from pathlib import Path
import os
import subprocess
import json

ROOT = Path(__file__).resolve().parents[1]

def main():
    shell = Path(os.environ.get('OMARCHY_SHELL_DIR', '/usr/share/omarchy/shell'))
    if not (shell / 'Ui/PanelHero.qml').exists():
        raise SystemExit('Omarchy shell sources are required to capture the native renderer.')
    subprocess.run(['node', str(ROOT / 'scripts/prepare-ui.mjs')], check=True)
    work = ROOT / '.build/omarchy-preview'
    work.mkdir(parents=True, exist_ok=True)
    for name in ('Ui','Commons'):
        target = work / name
        if not target.exists(): target.symlink_to(shell / name, target_is_directory=True)
    (work / 'Model.js').write_text((ROOT / 'integrations/omarchy/pain/Model.js').read_text())
    for name, source_path in (
        ('Panel.mjs', ROOT / 'integrations/omarchy/pain/Panel.mjs'),
        ('.generated', ROOT / '.build/pain-ui'),
    ):
        target = work / name
        if not target.exists(): target.symlink_to(source_path, target_is_directory=source_path.is_dir())
    for name in ('App.mjs', 'AppState.mjs'):
        target = work / name
        if not target.exists(): target.symlink_to(ROOT / 'integrations/omarchy/pain' / name)
    fixtures = json.loads((ROOT / 'desktop/public/fixtures.json').read_text())
    for name, status in fixtures.items():
        if os.environ.get('PAIN_PREVIEW_STATE') and name != os.environ['PAIN_PREVIEW_STATE']:
            continue
        output = ROOT / f'desktop/public/omarchy/{name}.png'
        qml = '''import QtQuick
import QtQuick.Window
import "App.mjs" as View
import "AppState.mjs" as State
import ".generated" as Zen
Window {
    width:460; height:720; visible:true; color:"#171b1a"
    property var status: STATUS
    Rectangle { id:capture; anchors.fill:parent; color:"#171b1a"
        Zen.Application { anchors.fill:parent; tree:View.appView(status,State.initialState(status)) }
    }
    Timer { interval:1200; running:true; onTriggered:capture.grabToImage(function(result) { if(!result.saveToFile(OUTPUT)) Qt.exit(2); else Qt.quit() }) }
}
'''.replace('STATUS', json.dumps(status)).replace('OUTPUT', json.dumps(str(output)))
        (work / 'shell.qml').write_text(qml)
        runtime = work / 'runtime'
        runtime.mkdir(mode=0o700, exist_ok=True)
        env = dict(os.environ, XDG_RUNTIME_DIR=str(runtime), QT_QPA_PLATFORM='offscreen', QT_QUICK_BACKEND='software')
        try:
            result = subprocess.run(['quickshell', '-p', str(work / 'shell.qml')], env=env, check=True, timeout=20,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
            print(getattr(exc, 'stdout', b''))
            print(getattr(exc, 'stderr', b''))
            raise
        diagnostics = (result.stdout + result.stderr).decode(errors='replace')
        if any(marker in diagnostics for marker in ('ReferenceError:', 'TypeError:', 'Binding loop detected', 'Failed to load configuration')):
            raise RuntimeError(diagnostics)
        print('Captured', output.relative_to(ROOT))

if __name__ == '__main__': main()
