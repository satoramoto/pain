import { column, row, text, button, section } from './.generated/ui.mjs';
import * as Model from './.generated/model.mjs';

// The manager and native guide use Zen's portable controls. The richer original
// dashboard keeps its native primitives and a Mac binding of Model.panelState.
function actionButton(ui, label, action, payload, props = {}) {
  return button(label, action, {
    payload, focusKey: action + ':' + (payload || ''),
    cursor: ui.cursor === action + ':' + (payload || ''), ...props,
  });
}

export function view(status, ui = {}) {
  const busy = !!status.busy;
  const children = [row([
    text('Models', { grow: true, detail: 'Download, choose, or remove local models.' }),
    actionButton(ui, 'Back', 'dashboard'),
  ])];
  if (status.busy) children.push(text(status.controlLine || status.busy, { tone: 'muted' }));
  if (status.error) children.push(text(status.error, { tone: 'danger' }));
  const modelRows = (status.models || []).map(model => {
    const running = status.online && status.model_alias === model.id;
    const size = model.bytes ? (model.bytes / 1e9).toFixed(1) + ' GB' : '';
    const controls = [];
    const offer = model.downloaded ? (running ? '' : 'Use')
      : model.downloadable && !Model.modelTooLarge(model, status.memory) ? (model.received ? 'Resume' : 'Download') : '';
    if (offer) controls.push(actionButton(ui, offer, model.downloaded ? 'use' : 'fetch', model.id, { disabled: busy || status.runtimeReady === false }));
    const hasFiles = model.downloaded || model.received > 0;
    const reason = hasFiles ? Model.removalReason(model, status) : '';
    if (hasFiles) controls.push(actionButton(ui, 'Remove', 'request-remove', model.id, { disabled: busy || !!reason }));
    const content = [text(model.title, { detail: [model.id, size, Model.modelState(model, status)].filter(Boolean).join(' · ') })];
    if (controls.length) content.push(row(controls));
    if (reason) content.push(text(reason, { tone: 'muted' }));
    if (ui.removeId === model.id && hasFiles) {
      content.push(text('Remove ' + model.title + '?', { tone: 'danger', detail: 'Deletes this model’s downloaded files and partial downloads. Download it again to use it later.' }));
      content.push(row([
        actionButton(ui, 'Cancel', 'cancel-remove', model.id),
        actionButton(ui, 'Remove files', 'confirm-remove', model.id, { disabled: busy || !!reason }),
      ]));
    }
    return column(content, { key: 'model:' + model.id });
  });
  children.push(section('Supported models', modelRows.length ? modelRows : [text(status.runtimeReady === false
    ? 'Prepare your workspace in Getting Started to load the model catalog.'
    : 'The model catalog will appear after the next refresh.', { tone: 'muted' })]));
  children.push(row([actionButton(ui, 'Refresh', 'refresh', undefined, { disabled: busy }), actionButton(ui, 'Getting Started', 'getting-started')]));
  return column(children);
}

export function guide(status, ui = {}) {
  return column([
    row([text('Getting Started', { grow: true }), actionButton(ui, 'Back', 'dashboard')]),
    text('Your private AI workspace', { detail: 'PAIN runs models on this computer and serves them on localhost:11434.' }),
    section('1 · Choose a backend', [text('Use the backend chips on the dashboard. Start applies the selected backend; Restart replaces the running engine.')]),
    section('2 · Choose a model', [text('Open Models to download a supported model, resume a partial download, or use a model already on disk.'), row([actionButton(ui, 'Models', 'models')])]),
    section('3 · Start local inference', [text('Return to the dashboard and press Start. Inference, memory, and APU readings update while the panel is open.')]),
    section('Keyboard', [text('H/L or arrows choose a backend or action. J/K moves between rows. Enter activates. S start · D stop · M monitor · G logs · R refresh.')]),
    text('Removal requires a stopped engine and a separate confirmation in Models.', { tone: 'muted' }),
  ]);
}

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
