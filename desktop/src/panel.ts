import { engineLabel, contextText, speedText } from './model.js';
import './style.css';
export type Status = {
  online: boolean; backend: string; engine?: string; model_alias?: string;
  inference?: Record<string, number | boolean | null>; speed?: number;
  error?: string; busy?: string; runtimeReady?: boolean;
  models?: Model[]; memory?: number; fetching?: string;
};
export type Model = { id: string; title: string; downloaded: boolean; downloadable: boolean; bytes: number; received: number; selected: boolean };
export type Action = 'setup' | 'up' | 'down' | 'logs' | 'refresh' | 'download' | 'use' | 'fetch';
// Weights must fit in the memory macOS lets the GPU use, roughly 70% of RAM.
const tooLarge = (model: Model, memory = 0) => !!memory && model.bytes > memory * 0.7;
export function modelList(status: Status, action: (name: Action, value?: string) => void): HTMLElement {
  const list = document.createElement('ul'); list.className = 'models';
  for (const model of status.models || []) {
    const running = status.online && status.model_alias === model.id;
    const size = model.bytes ? `${(model.bytes / 1e9).toFixed(1)} GB` : '';
    const progress = model.bytes ? Math.min(99, Math.floor(model.received * 100 / model.bytes)) : 0;
    const state = running ? 'Running'
      : model.downloaded ? 'Downloaded'
      : status.fetching === model.id ? `Downloading… ${progress}%`
      : tooLarge(model, status.memory) ? 'Too large for this Mac'
      : !model.downloadable ? 'No download source'
      : model.received ? `${progress}% downloaded` : 'Not downloaded';
    const row = document.createElement('li'); if (running) row.className = 'running';
    const text = document.createElement('div');
    const name = document.createElement('b'); name.textContent = model.title;
    const detail = document.createElement('small'); detail.textContent = [model.id, size, state].filter(Boolean).join(' · ');
    text.append(name, detail); row.append(text);
    const offer = model.downloaded ? (running ? '' : 'Use')
      : model.downloadable && !tooLarge(model, status.memory) ? (model.received ? 'Resume' : 'Download') : '';
    if (offer) {
      const b = document.createElement('button'); b.textContent = offer; b.disabled = !!status.busy;
      b.setAttribute('aria-label', `${offer} ${model.title}`);
      b.onclick = () => action(model.downloaded ? 'use' : 'fetch', model.id); row.append(b);
    }
    list.append(row);
  }
  return list;
}
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
  if (status.models?.length) root.append(label('small', 'MODELS'), modelList(status, action));
  root.append(label('small', 'ADD A MODEL BY URL'), form,
    label('p', 'Any HTTPS GGUF link. It appears in the list above; choose Use to load it.', 'hint'));
  if (status.error) { const error = label('p', status.error, 'error'); error.setAttribute('role', 'alert'); root.append(error); }
  root.append(label('p', 'Localhost only · Metal through VirtGPU', 'footnote'));
  return root;
}
