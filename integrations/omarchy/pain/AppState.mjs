// Portable application state. Both hosts dispatch named actions through this
// reducer; only returned effects may cross into platform services.
import { removalReason, panelState } from './.generated/model.mjs';

export const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'models', label: 'Models' },
  { id: 'logs', label: 'Logs' },
];

export function initialState(status = {}) {
  return { screen: 'dashboard', removeId: '', url: '', folder: status.modelsDir || '', cursor: null, backend: status.backend || '' };
}

export function transition(current, status, action, payload, logs = { state: 'idle' }) {
  const state = Object.assign({}, current);
  const effects = [];
  const emit = (name, value) => effects.push({ action: name, payload: value });
  const id = typeof payload === 'string' ? payload : '';
  const navigate = (screen, refreshLogs) => {
    state.screen = screen;
    state.removeId = '';
    state.cursor = null;
    if (screen === 'models') emit('refresh');
    if (screen === 'logs' && (refreshLogs || logs.state === 'idle')) emit('logs');
  };
  if (action === 'navigate' && tabs.some(tab => tab.id === id)) navigate(id, false);
  else if (['guide', 'dashboard', 'models'].includes(action)) navigate(action, false);
  else if (action === 'logs') navigate('logs', true);
  else if (action === 'select-backend' && (status.backends || []).includes(id)) state.backend = id;
  else if (action === 'edit-url') state.url = id;
  else if (action === 'edit-folder') state.folder = id;
  else if (action === 'cancel-remove') state.removeId = '';
  else if (action === 'escape') {
    if (state.removeId) state.removeId = '';
    else if (state.screen !== 'dashboard') navigate('dashboard', false);
    else emit('close');
  } else if (action === 'request-remove' || action === 'confirm-remove') {
    const model = (status.models || []).find(candidate => candidate.id === id);
    if (!status.busy && model && !removalReason(model, status)) {
      if (action === 'request-remove') state.removeId = id;
      else if (state.removeId === id) { state.removeId = ''; emit('remove', id); }
    }
  } else if (action === 'download') {
    if (!status.busy && status.runtimeReady !== false && /^https:\/\/\S+$/i.test(state.url)) emit('download', state.url);
  } else if (action === 'folder') {
    if (!status.busy && state.folder.trim()) emit('folder', state.folder.trim());
  } else if (action === 'refresh-logs') {
    if (logs.state !== 'loading') emit('logs');
  } else if (action === 'getting-started' || action === 'quit') emit(action);
  else if (action === 'up' || action === 'down') {
    const control = panelState(status, { platform: 'mac' }).actions.find(item => item.key === action);
    if (control && control.enabled) emit(action, action === 'up' ? state.backend : undefined);
  } else if (!status.busy && ['refresh', 'use', 'fetch'].includes(action)) emit(action, payload);
  return { state, effects };
}

export function keyAction(state, key) {
  if (key === 'Escape') return 'escape';
  if (key.toLowerCase() === 'g') return 'logs';
  if (state.screen !== 'dashboard') return '';
  return ({ s: 'up', d: 'down', r: 'refresh' })[key.toLowerCase()] || '';
}
