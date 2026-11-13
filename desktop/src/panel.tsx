import { useEffect, useState } from 'react';
import { Application } from '@satoramoto/zen/harness/omarchy/bench/Application.tsx';
import type { ApplicationNode } from '@satoramoto/zen/harness/omarchy/kit/application.mjs';
import { appView } from '../../integrations/omarchy/pain/App.mjs';
import { initialState, transition, keyAction } from '../../integrations/omarchy/pain/AppState.mjs';
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

// This host supplies state and executes effects. Layout lives in App.mjs.
function Panel({ status, action, logs }: { status: Status; action: Act; logs: LogsState }) {
  const [ui, setUi] = useState(() => initialState(status));
  useEffect(() => setUi(current => ({ ...current, folder: status.modelsDir || '' })), [status.modelsDir]);
  const send = (name: string, payload?: unknown, value?: unknown) => {
    const next = transition(ui, status, name, value === undefined ? payload : value, logs);
    setUi(next.state);
    for (const effect of next.effects) {
      if (effect.action !== 'close') action(effect.action as Action, effect.payload as string | undefined);
    }
  };
  return <ThemeFrame><Application appearance="visuals" tree={appView(status, ui, logs) as ApplicationNode} dispatch={send} handleKey={key => {
    const command = keyAction(ui, key);
    if (!command) return false;
    send(command); return true;
  }} /></ThemeFrame>;
}

export const panel = (status: Status, action: Act, logs: LogsState = initialLogs) => <Panel status={status} action={action} logs={logs} />;
