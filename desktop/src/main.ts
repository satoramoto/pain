import { invoke } from '@tauri-apps/api/core';
import { panel, type Status, type Action } from './panel';
let status: Status = { online: false, backend: 'llamacpp-metal', engine: 'llama.cpp' };
let busy = false;
let logs = '';
let sampledAt = 0;
let decoded = 0;
let model = '';
const root = document.querySelector<HTMLElement>('#app')!;
function render() {
  root.replaceChildren(panel(status, action));
  if (logs) { const pre = document.createElement('pre'); pre.textContent = logs; root.append(pre); }
}
async function refresh() {
  try {
    const next = await invoke<Status>('snapshot');
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
  busy = true; status.busy = command === 'up' ? 'STARTING' : command.toUpperCase(); status.error = ''; render();
  try {
    const result = await invoke<string>('control', { command, value: value || '' });
    status.busy = ''; await refresh();
    if (command === 'logs') { logs = result; render(); }
  } catch (error) { status.error = String(error); status.busy = ''; render(); }
  finally { busy = false; }
}
render(); void refresh(); setInterval(() => { if (!busy) void refresh(); }, 5000);
