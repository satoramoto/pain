import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { updates, type UpdateState } from './updates';
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
let showUpdates = false;
let updateState: UpdateState = {phase:'checking'};
let pendingUpdate: Update | null = null;
let updateBusy = false;
async function checkUpdates() {
  showUpdates = true;
  if (updateBusy || updateState.phase === 'restart') {render();return;}
  updateBusy = true; updateState = {phase:'checking'}; render();
  try {
    await pendingUpdate?.close(); pendingUpdate = null;
    if (!await invoke<boolean>('updates_configured')) {
      updateState = {phase:'error',error:'This build has no updater verification key. Install an update-enabled signed release to use app updates.'};
      return;
    }
    pendingUpdate = await check({timeout:30000});
    updateState = pendingUpdate ? {phase:'available',version:pendingUpdate.version,notes:pendingUpdate.body} : {phase:'current'};
  } catch (error) {updateState = {phase:'error',error:`${String(error)} Check your connection and try again. Updates become available after the first stable release.`};}
  finally {updateBusy = false;render();}
}
async function installUpdate() {
  if (updateBusy) return;
  if (busy) {updateState.error = 'Wait for the current pain(less) operation to finish before restarting.';render();return;}
  updateBusy = true;
  try {
    if (updateState.phase !== 'restart') {
      if (!pendingUpdate) return;
      updateState = {...updateState,phase:'downloading',received:0};render();
      await pendingUpdate.download(event => {
        if (event.event === 'Started') updateState.total = event.data.contentLength;
        if (event.event === 'Progress') updateState.received = (updateState.received || 0) + event.data.chunkLength;
        render();
      }, {timeout:300000});
      updateState.phase = 'installing';render();
      await pendingUpdate.install();
      updateState.phase = 'restart';render();
    }
    await relaunch();
  } catch (error) {
    updateState = {...updateState,phase:updateState.phase === 'restart' ? 'restart' : 'error',error:String(error)};
  } finally {updateBusy = false;render();}
}
let firstSnapshot = true;
const root = document.querySelector<HTMLElement>('#app')!;
const app = createRoot(root);
function render() {
  if (showUpdates) {
    const screen = updates(updateState, () => {void installUpdate();}, () => {void checkUpdates();}, () => {showUpdates=false;render();});
    app.render(h(ThemeFrame, {children:h('div', {ref:(element:HTMLDivElement|null)=>{element?.replaceChildren(screen);}})}));
    return;
  }
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
void listen('getting-started', () => {if(updateBusy)return;showUpdates=false;showSetup = true;render();});
void listen('check-updates', () => {void checkUpdates();});
render(); void refresh(); setInterval(() => {
  // Leave a partially edited folder path alone while a poll is in flight.
  if (document.activeElement instanceof HTMLInputElement) return;
  if (!busy && !showSetup && !showUpdates) void refresh();
  else if (status.fetching) void loadModels().then(render);
}, 5000);
