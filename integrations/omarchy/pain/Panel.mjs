import { column, row, text, button, section } from './.generated/ui.mjs';
import * as Model from './.generated/model.mjs';

// This is the complete PAIN panel, shared by Zen's Qt and React bindings.
// Hosts supply capabilities and handle named actions; neither owns panel markup.
export function actions(status, ui = {}) {
  const mac = ui.platform === 'mac';
  const disabled = !!status.busy;
  const unavailable = status.runtimeReady === false;
  const result = mac ? [{ key: 'setup', label: 'Prepare VM', disabled }] : [];
  result.push(
    { key: 'up', label: status.online ? 'Restart' : 'Start', disabled: disabled || unavailable },
    { key: 'down', label: 'Stop', disabled: disabled || !status.online },
  );
  if (!mac) result.push({ key: 'top', label: 'Monitor', disabled: false });
  result.push({ key: 'logs', label: 'Logs', disabled: disabled || unavailable || (!mac && !status.online) });
  return result;
}

function info(label, value, props = {}) {
  return row([text(label, { tone: 'muted' }), text(String(value), { grow: true })], props);
}

function meter(label, value, fraction) {
  const filled = Math.round(Model.clamp01(fraction) * 20);
  return text(label + '  ' + value, { detail: '━'.repeat(filled) + '─'.repeat(20 - filled) });
}

export function view(status, ui = {}) {
  const mac = ui.platform === 'mac';
  const online = status.online === true;
  const inf = status.inference || {};
  const loaded = !!status.model_alias;
  const generating = online && inf.processing === true;
  const busy = !!status.busy;
  const cursor = ui.cursor || '';
  const actionButton = (label, action, payload, props = {}) => button(label, action, {
    payload, focusKey: action + ':' + (payload || ''), cursor: cursor === action + ':' + (payload || ''), ...props,
  });
  const engine = Model.engineLabel(status);
  const state = status.busy || (online ? (generating ? 'GENERATING' : 'READY') : 'OFFLINE');
  const children = [
    row([
      text('PAIN', { grow: true, detail: engine + ' · ' + state }),
      actionButton('Refresh', 'refresh', undefined, { disabled: busy }),
    ], { key: 'hero' }),
  ];
  if (status.controlLine) children.push(text(status.controlLine, { tone: 'muted', key: 'operation' }));
  if (status.error) children.push(text(status.error, { tone: 'danger', key: 'error' }));

  children.push(section('Inference', [
    info('Model', status.model_alias || (online ? 'none loaded' : 'offline')),
    info('Prompt', inf.has_slot || Model.num(inf.prompt) > 0
      ? Model.kTokens(inf.prompt) + ' tokens · KV ' + Model.cacheHitText(inf) : '—'),
    info('Draft', loaded ? Model.draftText(inf, status) : '—'),
    info('Speed', generating ? Model.speedText(status.speed) : loaded && online ? 'idle' : '—'),
    meter('Context', Model.contextText(inf), Model.contextFraction(inf)),
  ]));

  // Only render telemetry supplied by the host. Mac RAM capacity is used for
  // catalog fit checks; it is not a fabricated live memory or APU measurement.
  const mem = status.memory;
  const hw = status.hardware || {};
  const split = status.memory_split;
  if (mem && typeof mem === 'object' && Model.num(mem.total_gib) > 0) {
    const memory = [meter('RAM', Model.gibPair(mem.used_gib, mem.total_gib), Model.num(mem.used_gib) / mem.total_gib)];
    if (split) {
      const segments = Model.ramSegments(split, loaded).filter(segment => segment.value > 0 || segment.key === 'sys');
      memory.push(text(segments.map(segment => segment.label + ' ' + segment.value.toFixed(1) + ' GiB').join(' · '), { tone: 'muted' }));
    }
    if (Model.num(hw.gtt_total_gib) > 0) {
      memory.push(meter('GTT', Model.gibPair(hw.gtt_used_gib, hw.gtt_total_gib), Model.num(hw.gtt_used_gib) / hw.gtt_total_gib));
      memory.push(text('GTT cap ' + Model.num(hw.gtt_total_gib).toFixed(0) + ' GiB · ' + Math.round(Model.gttCapFraction(hw, mem) * 100) + '% of RAM', { tone: 'muted' }));
    }
    if (status.swap) memory.push(info('Swap', Model.swapText(status.swap)));
    children.push(section('Memory', memory));
  }
  const hardware = [];
  if (hw.gpu_busy_pct !== undefined && hw.gpu_busy_pct !== null)
    hardware.push(meter('GPU', Math.round(Model.num(hw.gpu_busy_pct)) + '%', Model.num(hw.gpu_busy_pct) / 100));
  if (hw.ppt_w !== undefined && hw.ppt_w !== null)
    hardware.push(info('Power', Model.num(hw.ppt_w).toFixed(1) + ' W'));
  if (Model.tempsText(hw) !== '—') hardware.push(info('Thermals', Model.tempsText(hw)));
  if (hardware.length) children.push(section('APU', hardware));

  const backends = status.backends?.length ? status.backends : [status.backend].filter(Boolean);
  const selectedBackend = ui.selectedBackend || status.backend;
  children.push(section('Backend', [
    mac ? text(status.backend || 'Not prepared', { detail: 'The container framework selected in Getting Started determines the backend.' })
      : row(backends.map(backend => actionButton(backend, 'backend', backend, { selected: backend === selectedBackend, disabled: busy })), { key: 'backends' }),
    row(actions(status, ui).map(action => actionButton(action.label, action.key, undefined, { disabled: action.disabled })), { key: 'actions' }),
    text(online ? 'Restart replaces the running engine and interrupts requests.' : 'Start loads the selected model on the local engine.', { tone: 'muted' }),
  ]));

  const modelRows = (status.models || []).map(model => {
    const running = online && status.model_alias === model.id;
    const size = model.bytes ? (model.bytes / 1e9).toFixed(1) + ' GB' : '';
    const state = Model.modelState(model, status);
    const controls = [];
    const offer = model.downloaded ? (running ? '' : 'Use')
      : model.downloadable && !Model.modelTooLarge(model, status.memory) ? (model.received ? 'Resume' : 'Download') : '';
    if (offer) controls.push(actionButton(offer, model.downloaded ? 'use' : 'fetch', model.id, { disabled: busy || status.runtimeReady === false }));
    const hasFiles = model.downloaded || model.received > 0;
    const reason = hasFiles ? Model.removalReason(model, status) : '';
    if (hasFiles) controls.push(actionButton('Remove', 'request-remove', model.id, { disabled: busy || !!reason }));
    const content = [text(model.title, { detail: [model.id, size, state].filter(Boolean).join(' · ') })];
    if (controls.length) content.push(row(controls));
    if (reason) content.push(text(reason, { tone: 'muted' }));
    if (ui.removeId === model.id && hasFiles) {
      content.push(text('Remove ' + model.title + '?', { tone: 'danger', detail: 'Deletes this model’s downloaded files and partial downloads. Download it again to use it later.' }));
      content.push(row([
        actionButton('Cancel', 'cancel-remove', model.id),
        actionButton('Remove files', 'confirm-remove', model.id, { disabled: busy || !!reason }),
      ]));
    }
    return column(content, { key: 'model:' + model.id });
  });
  children.push(section('Models', modelRows.length ? modelRows : [text(status.runtimeReady === false ? 'Prepare the VM to load the model catalog.' : 'The model catalog will appear after the next refresh.', { tone: 'muted' })]));
  if (!mac) children.push(text('S start · D stop · M monitor · G logs · R refresh', { tone: 'muted' }));
  return column(children);
}

// Keyboard navigation follows the controls actually present in the shared tree,
// including model actions and the explicit removal confirmation.
export function controlRows(tree) {
  const rows = [];
  function visit(node) {
    if (node.kind === 'row' && node.children.some(child => child.kind === 'button')) {
      const controls = node.children.filter(child => child.kind === 'button' && !child.disabled);
      if (controls.length) rows.push(controls);
    } else (node.children || []).forEach(visit);
  }
  visit(tree);
  return rows;
}
