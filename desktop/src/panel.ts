import { createElement as h, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Preview } from '@satoramoto/zen/harness/omarchy/bench/Preview.tsx';
import { view } from '../../integrations/omarchy/pain/Panel.mjs';
import { removalReason } from '../../.build/pain-ui/model.mjs';
import './style.css';

export type Status = {
  online: boolean; backend: string; engine?: string; model_alias?: string; backends?: string[];
  inference?: Record<string, number | boolean | null>; speed?: number;
  error?: string; busy?: string; runtimeReady?: boolean;
  models?: Model[]; memory?: number; fetching?: string; modelsDir?: string;
};
export type Model = {
  id: string; title: string; downloaded: boolean; downloadable: boolean;
  bytes: number; received: number; selected: boolean; removable?: boolean; remove_blocked?: string;
};
export type Action = 'setup' | 'up' | 'down' | 'logs' | 'refresh' | 'download' | 'use' | 'fetch' | 'folder' | 'remove';
type Act = (name: Action, value?: string) => void;

function Panel({ status, action }: { status: Status; action: Act }) {
  const [removeId, setRemoveId] = useState('');
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState(status.modelsDir || '');
  useEffect(() => setFolder(status.modelsDir || ''), [status.modelsDir]);
  useEffect(() => {
    if (removeId && !status.models?.some(model => model.id === removeId)) setRemoveId('');
  }, [removeId, status.models]);
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
    if (['setup', 'up', 'down', 'logs', 'refresh', 'use', 'fetch'].includes(name)) action(name as Action, id);
  };
  const disabled = !!status.busy;
  const submitUrl = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && status.runtimeReady !== false) action('download', url);
  };
  const submitFolder = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) action('folder', folder);
  };
  return h('section', { className: 'panel', 'aria-label': 'PAIN dashboard' },
    h('div', { role: status.error ? 'alert' : undefined },
      h(Preview, { tree: view(status, { platform: 'mac', removeId }), dispatch, width: 520, theme: { font: 'ui-monospace, SFMono-Regular, Menlo, monospace' } })),
    h('div', { className: 'mac-controls' },
      h('form', { onSubmit: submitUrl },
        h('label', { htmlFor: 'model-url' }, 'ADD A MODEL BY URL'),
        h('div', { className: 'field-row' },
          h('input', { id: 'model-url', type: 'url', required: true, placeholder: 'https://…/model.gguf', 'aria-label': 'Model GGUF URL', value: url, disabled,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value) }),
          h('button', { type: 'submit', disabled: disabled || status.runtimeReady === false }, 'Download model')),
        h('p', { className: 'hint' }, 'Any HTTPS GGUF link. It appears in the list above; choose Use to load it.')),
      h('form', { onSubmit: submitFolder },
        h('label', { htmlFor: 'models-folder' }, 'MODELS FOLDER'),
        h('div', { className: 'field-row' },
          h('input', { id: 'models-folder', required: true, 'aria-label': 'Models folder', value: folder, disabled,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setFolder(event.target.value) }),
          h('button', { type: 'submit', disabled }, 'Change folder')),
        h('p', { className: 'hint' }, 'Must be inside your home folder. Changing it stops the engine; downloaded files stay in the old folder.')),
      h('p', { className: 'footnote' }, status.backend.includes('metal') ? 'Localhost only · Metal through VirtGPU' : 'Localhost only · CPU inference')),
  );
}

export const panel = (status: Status, action: Act) => h(Panel, { status, action });
