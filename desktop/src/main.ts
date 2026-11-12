import { listen } from '@tauri-apps/api/event';
import { initialSetup, onboarding, runSetup, type Framework } from './onboarding';
import { invoke } from '@tauri-apps/api/core';
import { panel, type Status, type Action } from './panel';
let status: Status = { online: false, backend: 'llamacpp-metal', engine: 'llama.cpp' };
let busy = false;
let logs = '';
let sampledAt = 0;
let decoded = 0;
let model = '';
let setup = initialSetup();
let showSetup = false;
let firstSnapshot = true;
const root = document.querySelector<HTMLElement>('#app')!;
function render() {
  if (showSetup) {
    root.replaceChildren(onboarding(setup, () => {
      if (busy) return;
      busy = true;
      void runSetup(setup, (step, selected) => invoke('onboarding_step', {step, selected}), render)
        .finally(() => {busy = false;});
    }, framework => {setup = {...initialSetup(), framework}; render();}, () => {showSetup = false; render();}, () => {
      void invoke('onboarding_step', {step:'launch',selected:setup.framework}).catch(error => {setup.error = String(error);render();});
    }));
    return;
  }
  root.replaceChildren(panel(status, action));
  const help = document.createElement('button'); help.className='getting-started'; help.textContent='Getting Started'; help.onclick=()=>{showSetup=true;render();}; root.prepend(help);
  if (logs) { const pre = document.createElement('pre'); pre.textContent = logs; root.append(pre); }
}
let modelsLoaded = false;
// Listing models starts a short-lived controller container, so it is not part of the 5s poll.
async function loadModels() {
  try {
    const next = await invoke<Pick<Status, 'models' | 'memory'>>('models');
    status = { ...status, ...next }; modelsLoaded = true;
  } catch { /* VM not running yet: keep the last list */ }
}
async function refresh() {
  if (!modelsLoaded && status.runtimeReady) await loadModels();
  try {
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
    status = { ...status, error: '', ...next, speed };
  }
  catch (error) { status = { ...status, online: false, error: String(error) }; }
  render();
}
async function action(command: Action, value?: string) {
  if (busy) return;
  if (command === 'refresh') { await refresh(); return; }
  const labels: Partial<Record<Action, string>> = { up: 'STARTING', use: 'SWITCHING', fetch: 'DOWNLOADING', download: 'DOWNLOADING' };
  busy = true; status.busy = labels[command] || command.toUpperCase(); status.error = '';
  status.fetching = command === 'fetch' ? value : ''; render();
  try {
    const result = await invoke<string>('control', { command, value: value || '' });
    status.busy = ''; status.fetching = ''; await loadModels(); await refresh();
    if (command === 'logs') { logs = result; render(); }
  } catch (error) { status.error = String(error); status.busy = ''; status.fetching = ''; await loadModels(); render(); }
  finally { busy = false; }
}
void listen('getting-started', () => {showSetup = true;render();});
render(); void refresh(); setInterval(() => {
  if (!busy && !showSetup) void refresh();
  else if (status.fetching) void loadModels().then(render);
}, 5000);
