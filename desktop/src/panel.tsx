import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Button, Group, Surface, Tabs } from './zen';
import { Tree } from '@satoramoto/zen/view/react';
import { Preview } from '@satoramoto/zen/harness/omarchy/bench/Preview.tsx';
import { themeOf } from '@satoramoto/zen/harness/omarchy/kit/theme.mjs';
import type { Element } from '@satoramoto/zen/harness/omarchy/kit/ui.mjs';
import { view } from '../../integrations/omarchy/pain/Panel.mjs';
import { panelState, removalReason } from '../../.build/pain-ui/model.mjs';
import { dashboardView, glyph, heroView, type Cursor } from './dashboard';
import { ThemeFrame } from './theme';
import './style.css';

type Reading = Record<string, number | string | null | undefined>;
export type Status = {
  online: boolean; backend: string; engine?: string; model_alias?: string; backends?: string[];
  inference?: Record<string, number | boolean | null>; speed?: number; telemetry_scope?: string;
  hardware?: Reading; memory_split?: Record<string, number>; swap?: Reading;
  error?: string; busy?: string; controlLine?: string; runtimeReady?: boolean;
  models?: Model[]; memory?: number | Reading; memoryCapacity?: number; fetching?: string; modelsDir?: string;
};
export type Model = {
  id: string; title: string; downloaded: boolean; downloadable: boolean;
  bytes: number; received: number; selected: boolean; removable?: boolean; remove_blocked?: string;
};
export type Action = 'getting-started' | 'quit' | 'setup' | 'up' | 'down' | 'logs' | 'refresh' | 'download' | 'use' | 'fetch' | 'folder' | 'remove';
export type LogsState = { state: 'idle' | 'loading' | 'ready' | 'error'; content: string; error: string };
const initialLogs: LogsState = { state: 'idle', content: '', error: '' };
type Act = (name: Action, value?: string) => void;
type Screen = 'dashboard' | 'models' | 'logs';
const tabs = [{ id: 'dashboard', label: 'Dashboard' }, { id: 'models', label: 'Models' }, { id: 'logs', label: 'Logs' }];

// The portable manager inherits the same real Zen scope as the dashboard.
const managerTheme = themeOf({ background: 'transparent', foreground: 'var(--text-1)', muted: 'var(--text-3)', accent: 'var(--accent)', urgent: 'var(--danger)', font: 'var(--font-sans)', size: 13, small: 12, gap: 12, rowGap: 8, padding: 0, radius: 8 });

// Native keeps its own Back/Refresh/guide navigation. The Mac tab shell owns
// those controls; the shared manager's model rows and confirmation stay intact.
function managerContent(node: Element): Element | null {
  if (['dashboard', 'getting-started', 'refresh'].includes(node.action || '')) return null;
  const children = node.children.map(managerContent).filter((child): child is Element => child !== null);
  return node.kind === 'row' && !children.length ? null : { ...node, children };
}

function Panel({ status, action, logs }: { status: Status; action: Act; logs: LogsState }) {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [removeId, setRemoveId] = useState('');
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState(status.modelsDir || '');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const urlForm = useRef<HTMLFormElement>(null), folderForm = useRef<HTMLFormElement>(null);
  const state = panelState(status, { platform: 'mac' });
  useEffect(() => setFolder(status.modelsDir || ''), [status.modelsDir]);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; setCursor(null); }, [screen]);
  useEffect(() => { root.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    if (removeId && !status.models?.some(model => model.id === removeId)) setRemoveId('');
  }, [removeId, status.models]);
  useEffect(() => { if (removeId) root.current?.querySelector<HTMLButtonElement>('[data-om-action="cancel-remove"]')?.focus(); }, [removeId]);

  const navigate = (next: string, refreshLogs = false) => {
    if (next !== 'dashboard' && next !== 'models' && next !== 'logs') return;
    setRemoveId(''); setScreen(next);
    if (next === 'models') action('refresh');
    if (next === 'logs' && (refreshLogs || logs.state === 'idle')) action('logs');
  };
  const runControl = (name: Action) => name === 'logs' ? navigate('logs', true) : action(name);
  const dispatch = (name: string, payload?: unknown) => {
    const id = typeof payload === 'string' ? payload : '';
    if (name === 'cancel-remove') { setRemoveId(''); return; }
    if (name === 'request-remove' || name === 'confirm-remove') {
      const model = status.models?.find(model => model.id === id);
      if (status.busy || !model || removalReason(model, status)) return;
      if (name === 'request-remove') setRemoveId(id);
      else if (removeId === id) { setRemoveId(''); action('remove', id); }
      return;
    }
    if (['use', 'fetch'].includes(name)) action(name as Action, id);
  };
  const activate = (row: number, index: number) => {
    if (row === 1) { const tab = tabs[index]; if (tab) { navigate(tab.id); root.current?.querySelector<HTMLButtonElement>(`#tabs-pain-${tab.id}`)?.focus(); } }
    else if (index === state.actions.length) { if (!status.busy) action('refresh'); }
    else { const control = state.actions[index]; if (control && (control.key === 'logs' || control.enabled)) runControl(control.key as Action); }
  };
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select')) return;
    if (event.key.toLowerCase() === 'g') { event.preventDefault(); navigate('logs', true); return; }
    if (target.closest('[role="tablist"]')) return;
    if (event.key === 'Escape' && screen !== 'dashboard') {
      event.preventDefault();
      if (removeId) setRemoveId(''); else { navigate('dashboard'); root.current?.querySelector<HTMLButtonElement>('#tabs-pain-dashboard')?.focus(); }
      return;
    }
    if (screen !== 'dashboard') return;
    const key = event.key.toLowerCase();
    const shortcut: Record<string, Action> = { s: 'up', d: 'down', g: 'logs', r: 'refresh' };
    if (shortcut[key]) {
      event.preventDefault();
      if (key === 'r' ? !status.busy : state.actions.some(control => control.key === shortcut[key] && control.enabled)) action(shortcut[key]);
    } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'h', 'j', 'k', 'l'].includes(key)) {
      event.preventDefault(); root.current?.focus();
      if (!cursor) { setCursor({ row: 0, index: 0 }); return; }
      const dy = ['arrowdown', 'j'].includes(key) ? 1 : ['arrowup', 'k'].includes(key) ? -1 : 0;
      const dx = ['arrowright', 'l'].includes(key) ? 1 : ['arrowleft', 'h'].includes(key) ? -1 : 0;
      const row = Math.max(0, Math.min(1, cursor.row + dy));
      setCursor({ row, index: Math.max(0, Math.min((row === 0 ? state.actions.length + 1 : tabs.length) - 1, cursor.index + dx)) });
    } else if (key === 'enter' && cursor && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault(); activate(cursor.row, cursor.index);
    }
  };
  const disabled = !!status.busy;
  const submitUrl = (event: FormEvent) => { event.preventDefault(); if (!disabled && status.runtimeReady !== false) action('download', url); };
  const submitFolder = (event: FormEvent) => { event.preventDefault(); if (!disabled) action('folder', folder); };
  const managerTree = managerContent(view({ ...status, memory: status.memoryCapacity ?? (typeof status.memory === 'number' ? status.memory : undefined) }, { platform: 'mac', removeId }))!;

  return <section ref={root} className="panel" tabIndex={-1} aria-label="PAIN" onKeyDown={handleKey}>
    <Surface as="header" layer="float" className="app-toolbar">
      <div className="app-heading">
        <Tree tree={heroView(status)} />
        <Button label="Quit" title="Quit PAIN; inference keeps running" size="md" variant="quiet" onPress={() => action('quit')} />
      </div>
      <div className="toolbar-navigation" data-cursor={cursor?.row === 1}>
        <Tabs name="PAIN" items={tabs} value={screen} panelId="pain-tab-panel" onChange={navigate} />
        <Button label="Getting Started" size="md" variant="quiet" onPress={() => action('getting-started')} />
      </div>
      <Group name="Engine controls" label={false} toolbar className="engine-toolbar">
        {state.actions.map((control, index) => <span className="toolbar-action" key={control.key} data-cursor={cursor?.row === 0 && cursor.index === index} onPointerEnter={() => setCursor({ row: 0, index })}>
          <Button label={control.label} title={control.key === 'logs' ? 'Open and refresh engine logs (G)' : control.tip} size="cell" variant={control.key === 'up' ? 'primary' : 'secondary'} hue={control.key === 'down' ? 'rec' : 't'} disabled={control.key !== 'logs' && !control.enabled} icon={<Tree tree={glyph(control.key as 'up' | 'down' | 'logs')} />} onPress={() => runControl(control.key as Action)} />
        </span>)}
        <span className="toolbar-action" data-cursor={cursor?.row === 0 && cursor.index === state.actions.length} onPointerEnter={() => setCursor({ row: 0, index: state.actions.length })}>
          <Button label="Refresh" title="Refresh status (R)" size="cell" variant="secondary" disabled={disabled} icon={<Tree tree={glyph('refresh')} />} onPress={() => action('refresh')} />
        </span>
      </Group>
    </Surface>

    <div ref={content} id="pain-tab-panel" role="tabpanel" aria-labelledby={`tabs-pain-${screen}`} tabIndex={0} className="tab-content">
      {screen === 'models' ? <div className="models-content">
        <Surface layer="raised" className="model-manager"><div role={status.error ? 'alert' : undefined}><Preview tree={managerTree} dispatch={dispatch} width={460} theme={managerTheme} /></div></Surface>
        <Surface layer="raised" className="manager-form"><Group name="Add a model by URL" direction="column" gap={3}>
          <form ref={urlForm} onSubmit={submitUrl}>
            <div className="field-row"><input type="url" required placeholder="https://…/model.gguf" aria-label="Model GGUF URL" value={url} disabled={disabled} onChange={event => setUrl(event.target.value)} /><Button label="Download" size="md" disabled={disabled || status.runtimeReady === false} onPress={() => urlForm.current?.requestSubmit()} /></div>
            <p className="hint">Any HTTPS GGUF link. Choose Use after the download finishes.</p>
          </form>
        </Group></Surface>
        <Surface layer="raised" className="manager-form"><Group name="Models folder" direction="column" gap={3}>
          <form ref={folderForm} onSubmit={submitFolder}>
            <div className="field-row"><input required aria-label="Models folder" value={folder} disabled={disabled} onChange={event => setFolder(event.target.value)} /><Button label="Change" size="md" disabled={disabled} onPress={() => folderForm.current?.requestSubmit()} /></div>
            <p className="hint">Inside your home folder. Changing it stops the engine; downloaded files stay in the old folder.</p>
          </form>
        </Group></Surface>
      </div> : screen === 'logs' ? <div className="logs-content">
        <Surface as="section" layer="raised" className="logs-section" aria-label="Engine logs">
          <Group name="Engine logs" direction="column" gap={3} aside={<Button label="Refresh logs" size="md" variant="secondary" disabled={logs.state === 'loading'} icon={<Tree tree={glyph('refresh')} />} onPress={() => action('logs')} />}>
            <p className="hint">Recent engine output. Refresh to read the latest lines.</p>
            {logs.state === 'loading' && <p className="logs-state" role="status">Loading logs…</p>}
            {logs.state === 'error' && <div className="logs-error" role="alert"><strong>Unable to read engine logs.</strong><p>{logs.error}</p></div>}
            {logs.state === 'ready' && !logs.content.trim() && <p className="logs-state" role="status">No engine log output yet.</p>}
            {logs.state === 'idle' && <p className="logs-state">Choose Refresh logs to read engine output.</p>}
            {!!logs.content.trim() && <>
              {(logs.state === 'loading' || logs.state === 'error') && <p className="hint">Showing the last successful log snapshot.</p>}
              <pre className="engine-logs" tabIndex={0} aria-label="Engine log output">{logs.content}</pre>
            </>}
          </Group>
        </Surface>
      </div> : <Tree tree={dashboardView(status)} />}
    </div>
  </section>;
}

export const panel = (status: Status, action: Act, logs: LogsState = initialLogs) => <ThemeFrame><Panel status={status} action={action} logs={logs} /></ThemeFrame>;
