import { engineLabel, contextText, speedText } from './model.js';
import './style.css';
export type Status = {
  online: boolean; backend: string; engine?: string; model_alias?: string;
  inference?: Record<string, number | boolean | null>; speed?: number;
  error?: string; busy?: string; runtimeReady?: boolean;
};
export type Action = 'setup' | 'up' | 'down' | 'logs' | 'refresh' | 'download';
export function panel(status: Status, action: (name: Action, value?: string) => void): HTMLElement {
  const root = document.createElement('section'); root.className = 'panel';
  const label = (tag: string, text: string, cls = '') => {
    const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
  };
  const header = document.createElement('header');
  header.append(label('span', '◈', 'mark'), label('h1', 'PAIN'), label('span', status.busy || (status.online ? 'ONLINE' : 'OFFLINE'), 'badge'));
  root.append(header, label('p', engineLabel(status), 'engine'));
  root.append(label('h2', status.model_alias || 'Your private AI, on this Mac.'));
  const stats = document.createElement('div'); stats.className = 'stats';
  for (const [name, value] of [['CONTEXT', contextText(status.inference || {})], ['GENERATION', speedText(status.speed || 0)]]) {
    const item = document.createElement('div'); item.append(label('small', name), label('strong', value)); stats.append(item);
  }
  root.append(stats);
  const controls = document.createElement('div'); controls.className = 'controls';
  const button = (title: string, command: Action, disabled = false) => {
    const b = document.createElement('button'); b.textContent = title; b.disabled = disabled;
    b.onclick = () => action(command); controls.append(b);
  };
  button('Prepare VM', 'setup', !!status.busy);
  button(status.online ? 'Restart' : 'Start', 'up', !!status.busy || !status.runtimeReady);
  button('Stop', 'down', !!status.busy || !status.online);
  button('Logs', 'logs', !!status.busy || !status.runtimeReady);
  button('Refresh', 'refresh', !!status.busy);
  root.append(controls);
  const form = document.createElement('form');
  const input = document.createElement('input'); input.type = 'url'; input.required = true;
  input.placeholder = 'https://…/model.gguf'; input.setAttribute('aria-label', 'Model GGUF URL');
  const submit = document.createElement('button'); submit.textContent = 'Download model'; submit.disabled = !!status.busy || !status.runtimeReady;
  form.append(input, submit); form.onsubmit = event => { event.preventDefault(); action('download', input.value); };
  root.append(label('small', 'MODEL SETUP'), form,
    label('p', 'Start with a small GGUF. Downloads create a 4k-context preset. Restart to load it.', 'hint'));
  if (status.error) { const error = label('p', status.error, 'error'); error.setAttribute('role', 'alert'); root.append(error); }
  root.append(label('p', 'Localhost only · Metal through VirtGPU', 'footnote'));
  return root;
}
