import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import { Tree } from '@satoramoto/zen/view/react';
import { Preview } from '@satoramoto/zen/harness/omarchy/bench/Preview.tsx';
import { themeOf } from '@satoramoto/zen/harness/omarchy/kit/theme.mjs';
import { view } from '../../integrations/omarchy/pain/Panel.mjs';
import { panelState, removalReason } from '../../.build/pain-ui/model.mjs';
import { dashboardView, type Cursor } from './dashboard';
import './style.css';

export type Status = {
  online: boolean; backend: string; engine?: string; model_alias?: string; backends?: string[];
  inference?: Record<string, number | boolean | null>; speed?: number;
  hardware?: Record<string, number | null>; memory_split?: Record<string, number>; swap?: Record<string, number>;
  error?: string; busy?: string; controlLine?: string; runtimeReady?: boolean;
  models?: Model[]; memory?: number | Record<string, number>; fetching?: string; modelsDir?: string;
};
export type Model = {
  id: string; title: string; downloaded: boolean; downloadable: boolean;
  bytes: number; received: number; selected: boolean; removable?: boolean; remove_blocked?: string;
};
export type Action = 'getting-started' | 'setup' | 'up' | 'down' | 'logs' | 'refresh' | 'download' | 'use' | 'fetch' | 'folder' | 'remove';
type Act = (name: Action, value?: string) => void;

// Same semantic roles as the native theme, matching the checked-in original
// capture. Omarchy continues to follow the user's live native palette.
const theme = themeOf({
  background: '#171b1a', foreground: '#c1dcdf', muted: '#82999a', accent: '#3f88b5', urgent: '#ad7798',
  font: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 13, small: 11,
  gap: 10, rowGap: 6, padding: 20, radius: 0,
});

function Panel({ status, action }: { status: Status; action: Act }) {
  const [screen, setScreen] = useState<'dashboard' | 'models'>('dashboard');
  const [removeId, setRemoveId] = useState('');
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState(status.modelsDir || '');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const root = useRef<HTMLElement>(null);
  const state = panelState(status, { platform: 'mac' });
  useEffect(() => setFolder(status.modelsDir || ''), [status.modelsDir]);
  useEffect(() => { root.current?.focus(); window.scrollTo(0, 0); setCursor(null); }, [screen]);
  useEffect(() => { root.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    if (removeId && !status.models?.some(model => model.id === removeId)) setRemoveId('');
    else if (removeId) root.current?.querySelector<HTMLButtonElement>('[data-om-action="cancel-remove"]')?.focus();
  }, [removeId, status.models]);
  const navigate = (next: 'dashboard' | 'models') => { setRemoveId(''); setScreen(next); if (next === 'models') action('refresh'); };
  const dispatch = (name: string, payload?: unknown) => {
    const id = typeof payload === 'string' ? payload : '';
    if (name === 'dashboard') { navigate('dashboard'); return; }
    if (name === 'cancel-remove') { setRemoveId(''); return; }
    if (name === 'request-remove' || name === 'confirm-remove') {
      const model = status.models?.find(model => model.id === id);
      if (status.busy || !model || removalReason(model, status)) return;
      if (name === 'request-remove') setRemoveId(id);
      else if (removeId === id) { setRemoveId(''); action('remove', id); }
      return;
    }
    if (['getting-started', 'up', 'down', 'logs', 'refresh', 'use', 'fetch'].includes(name)) action(name as Action, id);
  };
  const activate = (row: number, index: number) => {
    if (row === 1) { if (index === 0) navigate('models'); else action('getting-started'); }
    else { const control = state.actions[index]; if (control?.enabled) action(control.key as Action); }
  };
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Escape' && screen === 'models') {
      event.preventDefault();
      if (removeId) setRemoveId(''); else navigate('dashboard');
      return;
    }
    if (screen !== 'dashboard' || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const shortcut: Record<string, Action> = { s: 'up', d: 'down', g: 'logs', r: 'refresh' };
    if (shortcut[key]) {
      event.preventDefault();
      if (key === 'r' ? !status.busy : state.actions.some(control => control.key === shortcut[key] && control.enabled)) action(shortcut[key]);
      return;
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'h', 'j', 'k', 'l'].includes(key)) {
      event.preventDefault();
      root.current?.focus();
      if (!cursor) { setCursor({ row: 0, index: 0 }); return; }
      const dy = ['arrowdown', 'j'].includes(key) ? 1 : ['arrowup', 'k'].includes(key) ? -1 : 0;
      const dx = ['arrowright', 'l'].includes(key) ? 1 : ['arrowleft', 'h'].includes(key) ? -1 : 0;
      const row = Math.max(0, Math.min(1, cursor.row + dy));
      setCursor({ row, index: Math.max(0, Math.min((row === 0 ? state.actions.length : 2) - 1, cursor.index + dx)) });
    } else if (key === 'enter' && cursor && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault(); activate(cursor.row, cursor.index);
    }
  };
  const handlers = {
    refresh: () => action('refresh'), models: () => navigate('models'), 'getting-started': () => action('getting-started'),
    ...Object.fromEntries(state.actions.map(control => [control.key, () => { if (control.enabled) action(control.key as Action); }])),
    ...Object.fromEntries(state.actions.map((_, index) => [`cursor:0:${index}`, () => setCursor({ row: 0, index })])),
    'cursor:1:0': () => setCursor({ row: 1, index: 0 }), 'cursor:1:1': () => setCursor({ row: 1, index: 1 }),
  };
  const disabled = !!status.busy;
  const submitUrl = (event: FormEvent) => { event.preventDefault(); if (!disabled && status.runtimeReady !== false) action('download', url); };
  const submitFolder = (event: FormEvent) => { event.preventDefault(); if (!disabled) action('folder', folder); };
  const variables = { '--background': theme.background, '--foreground': theme.foreground, '--muted': theme.muted, '--accent': theme.accent, '--urgent': theme.urgent } as CSSProperties;
  return <section ref={root} className="panel" tabIndex={-1} aria-label={screen === 'dashboard' ? 'PAIN dashboard' : 'PAIN models'} onKeyDown={handleKey} style={variables}>
    {screen === 'models' ? <>
      <div role={status.error ? 'alert' : undefined}><Preview tree={view(status, { platform: 'mac', removeId })} dispatch={dispatch} width={460} theme={theme} /></div>
      <div className="mac-controls">
        <form onSubmit={submitUrl}>
          <label htmlFor="model-url">ADD A MODEL BY URL</label>
          <div className="field-row"><input id="model-url" type="url" required placeholder="https://…/model.gguf" aria-label="Model GGUF URL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} /><button type="submit" disabled={disabled || status.runtimeReady === false}>Download model</button></div>
          <p className="hint">Any HTTPS GGUF link. Choose Use after the download finishes.</p>
        </form>
        <form onSubmit={submitFolder}>
          <label htmlFor="models-folder">MODELS FOLDER</label>
          <div className="field-row"><input id="models-folder" required aria-label="Models folder" value={folder} disabled={disabled} onChange={event => setFolder(event.target.value)} /><button type="submit" disabled={disabled}>Change folder</button></div>
          <p className="hint">Must be inside your home folder. Changing it stops the engine; downloaded files stay in the old folder.</p>
        </form>
      </div>
    </> : <Tree tree={dashboardView(status, cursor)} handlers={handlers} />}
  </section>;
}

export const panel = (status: Status, action: Act) => <Panel status={status} action={action} />;
