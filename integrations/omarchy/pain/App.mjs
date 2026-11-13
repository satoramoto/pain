// The sole pain(less) application layout, rendered by Zen on both browser and Qt.
import { element, column, row, text, button, control } from './.generated/application.mjs';
import { panelState, known, clamp01 } from './.generated/model.mjs';
import { view as modelManager, guide } from './Panel.mjs';
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
    status.engine === 'ComfyUI' ? surface('Image generation', [text(presentation.online ? 'ComfyUI is ready.' : 'ComfyUI is offline.'), element('link', {label:status.endpoint || '', href:status.endpoint || ''}), text('Image models and workflows are managed in ComfyUI.', { tone: 'muted' })]) : presentation.online ? surface('Inference', [
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
  if (status.engine === 'ComfyUI') return surface('Image models', [
    text('ComfyUI manages its image models and workflows.'),
    element('link', {label:status.endpoint || '', href:status.endpoint || ''}),
    text('Choose an LLM backend and start it to manage GGUF models here.', { tone: 'muted' }),
  ]);
  const busy = !!status.busy;
  const tree = managerContent(modelManager(Object.assign({}, status, {
    memory: status.memoryCapacity || (typeof status.memory === 'number' ? status.memory : undefined),
  }), { removeId: ui.removeId }));
  return column([
    surface('', [tree]),
    surface('Add a model by URL', [
      row([
        control('input', 'Model GGUF URL', ui.url, 'edit-url', { grow: true, placeholder: 'https://…/model.gguf', submit: 'download', disabled: busy }),
        action('Download', 'download', { disabled: busy || status.runtimeReady === false }),
      ]),
      text('Any HTTPS GGUF link. Choose Use after the download finishes.', { tone: 'muted' }),
    ]),
    surface('Models folder', [
      row([
        control('input', 'Models folder', ui.folder, 'edit-folder', { grow: true, submit: 'folder', disabled: busy }),
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
  const state = panelState(status, { platform: 'mac' });
  const toolbar = surface('', [
    row([
      element('hero', { label: 'pain(less)', detail: state.detail, meta: state.meta, icon: 'brain', grow: true, active: state.generating || state.busy }),
      action('?', capabilities.guide ? 'guide' : 'getting-started', { variant: 'quiet', title: 'Getting Started', width:28 }),
      action('Quit', 'quit', { variant: 'quiet', title: 'Quit pain(less); inference keeps running' }),
    ]),
    row([
      element('tabs', { label: 'pain(less)', options: tabs.map(tab => ({ label: tab.label, value: tab.id })), value: ui.screen === 'guide' ? 'dashboard' : ui.screen, action: 'navigate', grow: true }),
    ]),
    row(state.actions.map(item => element(item.key === 'up' && capabilities.backendSelection ? 'split-button' : 'button', {
      label:item.label, action:item.key, icon:item.key,
      selectionLabel:'Engine backend', selectionAction:'select-backend', selectionDisabled:!!status.busy,
      value:ui.backend || status.backend, options:(status.backends || []).map(value=>({label:value,value})),
      disabled: item.key !== 'logs' && !item.enabled,
      variant: item.key === 'up' ? 'primary' : 'secondary',
      tone: item.key === 'down' ? 'danger' : 'normal', title: item.tip,
      grow: !(item.key === 'up' && capabilities.backendSelection), width:item.key === 'up' && capabilities.backendSelection ? 128 : undefined,
    })).concat([action('Refresh', 'refresh', { icon:'', disabled: !!status.busy, grow: true })])),
    status.error ? text(status.error, { tone: 'danger', role: 'alert' }) : null,
  ].filter(Boolean), { layer: 'float', key: 'toolbar' });
  const content = ui.screen === 'guide' ? surface('', [guide(status, ui)]) : ui.screen === 'models' ? models(status, ui)
    : ui.screen === 'logs' ? logView(logs) : dashboard(status, state);
  return element('application', { label: 'pain(less)', screen: ui.screen, width: 460 }, [toolbar, content]);
}
