#!/usr/bin/env python3
"""Capture the actual Widget.qml panel markup with Omarchy's real components.

The harness omits the shell window/IPC/process layer and feeds fixtures to the
same property bindings, Flickable, and local components used in production.
"""
from pathlib import Path
import os
import subprocess
import json

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'integrations/omarchy/pain/Widget.qml').read_text()

def block(text, start):
    opening = text.index('{', start)
    depth = 1
    i = opening + 1
    quote = None
    while depth:
        c = text[i]
        if quote:
            if c == '\\': i += 1
            elif c == quote: quote = None
        elif c in ('"', "'"): quote = c
        elif c == '{': depth += 1
        elif c == '}': depth -= 1
        i += 1
    return text[start:i]


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
    imports = source[:source.index('// PAIN bar widget')]
    properties = source[source.index('  property var status:'):source.index('  function refresh()')]
    markup = block(source, source.index('      Flickable {'))
    components = source[source.index('  component InfoPair:'):source.rfind('}')]
    fixtures = json.loads((ROOT / 'desktop/public/fixtures.json').read_text())
    for name, status in fixtures.items():
        if os.environ.get('PAIN_PREVIEW_STATE') and name != os.environ['PAIN_PREVIEW_STATE']:
            continue
        output = ROOT / f'desktop/public/omarchy/{name}.png'
        props = properties.replace('property var status: ({})', 'property var status: (' + json.dumps(status) + ')')
        props = props.replace('property string busyAction: ""', 'property string busyAction: "up"' if name == 'starting' else 'property string busyAction: ""')
        props = props.replace('property real liveSpeed: 0', 'property real liveSpeed: ' + str(status.get('speed', 0)))
        qml = imports + '\nimport QtQuick.Window\nWindow {\n id: root\n width: 440; height: column.implicitHeight + 40; visible: true; color: "#171b1a"\n property var bar: null\n' + props
        qml += '\n function refresh() {}\n function runAction(key) {}\n function backendIndex() { return 0 }\n function showScreen(screen) {}\n'
        qml += '\n Rectangle { id: capture; color: "#171b1a"; anchors.fill: parent; anchors.margins: 20\n' + markup + '\n}\n' + components
        qml += '\n Timer { interval: 1200; running: true; onTriggered: capture.grabToImage(function(result) { if (!result.saveToFile(' + json.dumps(str(output)) + ')) Qt.exit(2); else Qt.quit(); }) }\n}\n'
        (work / 'shell.qml').write_text(qml)
        env = dict(os.environ, QT_QPA_PLATFORM='offscreen', QT_QUICK_BACKEND='software')
        try:
            subprocess.run(['quickshell', '-p', str(work / 'shell.qml')], env=env, check=True, timeout=20,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
            print(getattr(exc, 'stdout', b''))
            print(getattr(exc, 'stderr', b''))
            raise
        print('Captured', output.relative_to(ROOT))

if __name__ == '__main__': main()
