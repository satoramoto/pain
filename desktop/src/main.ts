import { listen } from '@tauri-apps/api/event';
import { initialSetup, onboarding, runSetup, type Framework } from './onboarding';
import { invoke } from '@tauri-apps/api/core';
import { panel, type Status, type Action, type LogsState } from './panel';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeFrame } from './theme';
let status: Status = { online: false, backend: 'llamacpp-metal', engine: 'llama.cpp' };
let busy = false;
let logs: LogsState = { state: 'idle', content: '', error: '' };
let controlError = '';
let sampledAt = 0;
let decoded = 0;
let model = '';
let setup = initialSetup();
let showSetup = false;
let firstSnapshot = true;
const root = document.querySelector<HTMLElement>('#app')!;
const app = createRoot(root);
function render() {
  if (showSetup) {
    const screen = onboarding(setup, () => {
      if (busy) return;
      busy = true;
      void runSetup(setup, (step, selected) => invoke('onboarding_step', {step, selected}), render)
        .finally(() => {busy = false;});
    }, framework => {setup = {...initialSetup(), framework}; render();}, () => {showSetup = false; render();}, () => {
      void invoke('onboarding_step', {step:'launch',selected:setup.framework}).catch(error => {setup.error = String(error);render();});
    });
    app.render(h(ThemeFrame, { children: h('div', { ref: (element: HTMLDivElement | null) => { element?.replaceChildren(screen); } }) }));
    return;
  }
  app.render(panel(status, action, logs));
}
let modelsLoaded = false;
// Listing models starts a short-lived controller container, so it is not part of the 5s poll.
async function loadModels() {
  try {
    const next = await invoke<{ models?: Status['models']; memoryCapacity?: number; memory?: number }>('models');
    // Catalog capacity is a fit hint in bytes; snapshot.memory is live host
    // telemetry. Never replace the latter with the catalog's numeric capacity.
    status = { ...status, models: next.models, memoryCapacity: next.memoryCapacity ?? next.memory ?? status.memoryCapacity };
    modelsLoaded = true;
  } catch { /* VM not running yet: keep the last list */ }
}
async function refresh() {
  try {
    const previousOnline = status.online;
    const next = await invoke<Status & {framework: Framework; onboarded: boolean}>('snapshot');
    if (firstSnapshot) {
      setup.framework = next.framework;
      showSetup = !next.onboarded;
      firstSnapshot = false;
    }
    const now = performance.now(); const count = Number(next.inference?.decoded || 0);
    const speed = next.inference?.processing && sampledAt && model === next.model_alias && count >= decoded
      ? (count - decoded) * 1000 / (now - sampledAt) : 0;
    decoded = count; sampledAt = now; model = next.model_alias || '';
    status = { ...status, ...next, error: controlError || next.error || '', speed };
    if (status.runtimeReady && (!modelsLoaded || previousOnline !== status.online)) await loadModels();
  }
  catch (error) { status = { ...status, online: false, error: String(error) }; }
  render();
}
// A bounded log read has its own request state. Polling and engine operations
// must neither clear its result/error nor wait for it to finish.
async function loadLogs() {
  if (logs.state === 'loading') return;
  logs = { ...logs, state: 'loading', error: '' }; render();
  try {
    const content = await invoke<string>('control', { command: 'logs', value: '' });
    logs = { state: 'ready', content, error: '' };
  } catch (error) { logs = { ...logs, state: 'error', error: String(error) }; }
  render();
}
async function action(command: Action, value?: string) {
  if (command === 'quit') {
    try { await invoke('quit_app'); }
    catch (error) { controlError = String(error); status.error = controlError; render(); }
    return;
  }
  if (command === 'getting-started') { showSetup = true; render(); return; }
  if (command === 'logs') { await loadLogs(); return; }
  if (busy) return;
  if (command === 'refresh') { modelsLoaded = false; await refresh(); return; }
  const labels: Partial<Record<Action, string>> = { up: 'STARTING', use: 'SWITCHING', fetch: 'DOWNLOADING', download: 'DOWNLOADING', folder: 'CHANGING FOLDER', remove: 'REMOVING' };
  busy = true; controlError = ''; status.busy = labels[command] || command.toUpperCase(); status.error = '';
  status.fetching = command === 'fetch' ? value : ''; render();
  try {
    await invoke<string>('control', { command, value: value || '' });
    status.busy = ''; status.fetching = ''; modelsLoaded = false; await refresh();
  } catch (error) { controlError = String(error); status.error = controlError; status.busy = ''; status.fetching = ''; await loadModels(); render(); }
  finally { busy = false; }
}
void listen('getting-started', () => {showSetup = true;render();});
render(); void refresh(); setInterval(() => {
  // Leave a partially edited folder path alone while a poll is in flight.
  if (document.activeElement instanceof HTMLInputElement) return;
  if (!busy && !showSetup) void refresh();
  else if (status.fetching) void loadModels().then(render);
}, 5000);
