#!/usr/bin/env python3
"""Capture the shared PAIN panel through Zen's real native QML binding.

The host omits bar placement, IPC and engine processes; it renders Panel.mjs
with the same Zen.Tree and native theme used by Widget.qml.
"""
from pathlib import Path
import os
import subprocess
import json

ROOT = Path(__file__).resolve().parents[1]


def main():
    shell = Path(os.environ.get('OMARCHY_SHELL_DIR', '/usr/share/omarchy/shell'))
    if not (shell / 'Ui/Button.qml').exists():
        raise SystemExit('Omarchy shell sources are required to capture the native renderer.')
    subprocess.run(['node', str(ROOT / 'scripts/prepare-ui.mjs')], check=True)
    work = ROOT / '.build/omarchy-preview'
    work.mkdir(parents=True, exist_ok=True)
    for name in ('Ui', 'Commons'):
        target = work / name
        if not target.exists():
            target.symlink_to(shell / name, target_is_directory=True)
    fixtures = json.loads((ROOT / 'desktop/public/fixtures.json').read_text())
    panel = json.dumps((ROOT / 'integrations/omarchy/pain/Panel.mjs').as_uri())
    kit = json.dumps((ROOT / '.build/pain-ui').as_uri())
    for name, status in fixtures.items():
        if os.environ.get('PAIN_PREVIEW_STATE') and name != os.environ['PAIN_PREVIEW_STATE']:
            continue
        output = ROOT / f'desktop/public/omarchy/{name}.png'
        qml = f'''import QtQuick
import QtQuick.Window
import {panel} as View
import {kit} as Zen
Window {{
  width: 440; height: panelView.height + 40; visible: true
  color: nativeTheme.snapshot.background
  property var status: ({json.dumps(status)})
  Zen.Theme {{ id: nativeTheme; followPalette: true }}
  Rectangle {{
    id: capture
    anchors.fill: parent
    color: nativeTheme.snapshot.background
    Zen.Tree {{
      id: panelView
      x: 20; y: 20; width: parent.width - 40
      node: View.view(status, {{platform: "omarchy", selectedBackend: status.backend}})
      theme: nativeTheme.snapshot
    }}
  }}
  Timer {{
    interval: 1200; running: true
    onTriggered: capture.grabToImage(function(result) {{
      if (!result.saveToFile({json.dumps(str(output))})) Qt.exit(2)
      else Qt.quit()
    }})
  }}
}}
'''
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


if __name__ == '__main__':
    main()
