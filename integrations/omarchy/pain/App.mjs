// The sole PAIN application layout, rendered by Zen on both browser and Qt.
import { element, column, row, text, button, control } from './.generated/ui.mjs';
import { panelState, known, clamp01 } from './.generated/model.mjs';
import { view as modelManager } from './Panel.mjs';
import { tabs } from './AppState.mjs';

const surface = (label, children, props = {}) => element('surface', Object.assign({ label }, props), children);
const pair = (label, value) => element('reading', { label, value: String(value) });
const meter = (label, value, fraction, tone = 'normal', pulsing = false) =>
  element('meter', { label, value, fraction: clamp01(fraction), tone, pulsing });
const action = (label, name, props = {}) => button(label, name, Object.assign({ icon: name }, props));

function managerContent(node) {
  if (['dashboard', 'getting-started', 'refresh'].includes(node.action || '')) return null;
  const children = (node.children || []).map(managerContent).filter(Boolean);
  return node.kind === 'row' && !children.length ? null : Object.assign({}, node, { children });
}

function dashboard(status, presentation) {
  const data = presentation.inference, memory = presentation.memory, hardware = presentation.hardware;
  const host = status.telemetry_scope === 'macos-host' ? 'macOS host' : 'Linux host';
  const model = (status.models || []).find(candidate => candidate.id === status.model_alias);
  const hasRam = memory.available && typeof status.memory === 'object' && status.memory !== null && known(status.memory.used_gib);
  const compute = [
    hardware.cpu !== 'Unavailable' ? meter('CPU', hardware.cpu, hardware.cpuFraction) : null,
    hardware.gpu !== 'Unavailable' ? meter('GPU', hardware.gpu, hardware.gpuFraction, hardware.gpuFraction >= .8 ? 'accent' : 'normal') : null,
    hardware.power !== 'Unavailable' ? meter('Power', hardware.power, hardware.powerFraction) : null,
    hardware.thermals !== 'Unavailable' ? pair('Thermals', hardware.thermals) : null,
  ].filter(Boolean);
  return column([
    presentation.online ? surface('Inference', [
      pair('Model', model ? model.title : data.model), pair('Prompt', data.prompt),
      pair('Draft', data.draft), pair('Speed', data.speed),
      meter('Context', data.context, data.fraction, 'normal', presentation.generating),
    ], { aside: presentation.generating ? 'Generating' : 'Ready' }) : null,
    hasRam || memory.gttAvailable ? surface('Memory', [
      hasRam ? pair('RAM', memory.ram) : null,
      hasRam ? element('stacked-meter', {
        label: 'RAM', value: memory.ram, total: memory.total,
        segments: memory.segments, marker: memory.gttCap, markerLabel: memory.gttCaption,
      }) : null,
      memory.gttAvailable ? meter('GTT', memory.gtt, memory.gttRatio, memory.gttRatio >= .9 ? 'danger' : 'normal') : null,
    ].filter(Boolean), { aside: host }) : null,
    compute.length ? surface('Compute', compute, { aside: host }) : null,
  ].filter(Boolean));
}

function models(status, ui) {
  const busy = !!status.busy;
  const tree = managerContent(modelManager(Object.assign({}, status, {
    memory: status.memoryCapacity || (typeof status.memory === 'number' ? status.memory : undefined),
  }), { removeId: ui.removeId }));
  return column([
    surface('', [tree]),
    surface('Add a model by URL', [
      row([
        control('input', 'Model GGUF URL', ui.url, 'edit-url', { grow: true, placeholder: 'https://…/model.gguf', disabled: busy }),
        action('Download', 'download', { disabled: busy || status.runtimeReady === false }),
      ]),
      text('Any HTTPS GGUF link. Choose Use after the download finishes.', { tone: 'muted' }),
    ]),
    surface('Models folder', [
      row([
        control('input', 'Models folder', ui.folder, 'edit-folder', { grow: true, disabled: busy }),
        action('Change', 'folder', { disabled: busy }),
      ]),
      text('Inside your home folder. Changing it stops the engine; downloaded files stay in the old folder.', { tone: 'muted' }),
    ]),
  ]);
}

function logView(logs) {
  const lines = [
    row([text('Engine logs', { grow: true, strong: true }), action('Refresh logs', 'refresh-logs', { icon: 'refresh', disabled: logs.state === 'loading' })]),
    text('Recent engine output. Refresh to read the latest lines.', { tone: 'muted' }),
  ];
  if (logs.state === 'loading') lines.push(text('Loading logs…', { role: 'status' }));
  if (logs.state === 'error') lines.push(text('Unable to read engine logs.', { detail: logs.error, tone: 'danger', role: 'alert' }));
  if (logs.state === 'ready' && !logs.content.trim()) lines.push(text('No engine log output yet.', { role: 'status' }));
  if (logs.state === 'idle') lines.push(text('Choose Refresh logs to read engine output.'));
  if (logs.content.trim()) {
    if (logs.state === 'loading' || logs.state === 'error') lines.push(text('Showing the last successful log snapshot.', { tone: 'muted' }));
    lines.push(element('code', { label: 'Engine log output', value: logs.content }));
  }
  return surface('', lines, { key: 'logs' });
}

export function appView(status, ui, logs = { state: 'idle', content: '' }, capabilities = {}) {
  const state = panelState(status, { platform: capabilities.platform || 'mac' });
  const toolbar = surface('', [
    row([
      element('hero', { label: 'PAIN', detail: state.detail, meta: state.meta, icon: 'brain', grow: true, active: state.generating || state.busy }),
      action('Quit', 'quit', { variant: 'quiet', title: 'Quit PAIN; inference keeps running' }),
    ]),
    row([
      element('tabs', { label: 'PAIN', options: tabs.map(tab => ({ label: tab.label, value: tab.id })), value: ui.screen, action: 'navigate', grow: true }),
      action('Getting Started', 'getting-started', { variant: 'quiet' }),
    ]),
    row(state.actions.map(item => action(item.label, item.key, {
      disabled: item.key !== 'logs' && !item.enabled,
      variant: item.key === 'up' ? 'primary' : 'secondary',
      tone: item.key === 'down' ? 'danger' : 'normal', title: item.tip, grow: true,
    })).concat([action('Refresh', 'refresh', { disabled: !!status.busy, grow: true })])),
    status.error ? text(status.error, { tone: 'danger', role: 'alert' }) : ui.screen === 'dashboard'
      ? text((state.online ? 'Restart interrupts requests. ' : '') + 'S start · D stop · G logs · R refresh', { tone: 'muted' }) : null,
  ].filter(Boolean), { layer: 'float', key: 'toolbar' });
  const content = ui.screen === 'models' ? models(status, ui)
    : ui.screen === 'logs' ? logView(logs) : dashboard(status, state);
  return element('application', { label: 'PAIN', screen: ui.screen, width: 460 }, [toolbar, content]);
}
