import { each, h, iconNode, wire, type Node } from '@satoramoto/zen/view';
import { clamp01, panelState } from '../../.build/pain-ui/model.mjs';
import type { Status } from './panel';

export interface Cursor { row: number; index: number }
type GlyphName = 'brain' | 'refresh' | 'up' | 'down' | 'logs';

function glyph(name: GlyphName): Node {
  // The original glyph's outline anatomy, rendered through Zen's SVG primitive
  // so the Mac webview does not depend on an installed Nerd Font.
  const paths = name === 'brain' ? [
    h('path', { d: 'M12 5c-1-3-5-3-6 0-3 0-5 4-3 6-2 2-1 6 2 7 0 4 6 5 7 1 1 4 7 3 7-1 3-1 4-5 2-7 2-2 0-6-3-6-1-3-5-3-6 0Z' }),
    h('path', { d: 'M12 5v14M6 5c0 2 1 3 3 3M3 11h3c2 0 3-1 3-3M5 18v-3c0-2 2-3 4-2M18 5c0 2-1 3-3 3M21 11h-3c-2 0-3-1-3-3M19 18v-3c0-2-2-3-4-2' }),
  ] : name === 'refresh' ? [h('path', { d: 'M20 7v5h-5M4 17v-5h5' }), h('path', { d: 'M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1' })]
    : name === 'up' ? [h('path', { d: 'm8 5 11 7-11 7Z', fill: 'currentColor', stroke: 'none' })]
    : name === 'down' ? [h('rect', { x: '6', y: '6', width: '12', height: '12', fill: 'currentColor', stroke: 'none' })]
    : [h('rect', { x: '3', y: '4', width: '18', height: '16', rx: '1' }), h('path', { d: 'm7 9 3 3-3 3m6 0h4' })];
  return iconNode({ className: `glyph glyph-${name}` }, {}, paths);
}

function pair(label: string, value: string): Node {
  return h('div', { class: 'info-pair' }, h('span', { class: 'info-label' }, label), h('span', { class: 'info-value', title: value }, value));
}

function meter(label: string, value: string, fraction: number, tone = 'normal', pulsing = false): Node {
  const level = clamp01(fraction);
  return h('div', { class: `native-meter meter-${tone}` }, pair(label, value),
    h('div', { class: 'meter-track', role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': value === 'Unavailable' ? undefined : String(Math.round(level * 100)), 'aria-valuetext': value },
      h('span', { class: `meter-fill${pulsing ? ' pulsing' : ''}`, style: `width:${level * 100}%;min-width:${level > 0 ? 6 : 0}px` })));
}

// A real Zen view model: all dashboard HTML, SVG, geometry, and named actions
// are rendered by @satoramoto/zen/view/react. Native QML keeps its original
// rich controls while sharing the same Model.panelState presentation contract.
export function dashboardView(status: Status, cursor: Cursor | null): Node {
  const state = panelState(status, { platform: 'mac' });
  const data = state.inference, memory = state.memory, hardware = state.hardware;
  const colors = ['var(--accent)', 'var(--draft)', 'var(--kv)', 'var(--system)'];
  return h('div', { class: 'dashboard' },
    h('header', { class: `panel-hero${state.generating || state.busy ? ' hero-active' : ''}${!state.online && !state.busy ? ' hero-offline' : ''}` },
      h('span', { class: 'hero-icon' }, glyph('brain')),
      h('div', { class: 'hero-copy' },
        h('div', { class: 'hero-title-row' }, h('h1', {}, 'PAIN'), state.detail ? h('span', { class: 'hero-badge', title: state.detail }, state.detail) : null),
        h('p', { class: 'hero-meta', title: state.meta }, state.meta)),
      wire(h('button', { class: 'hero-refresh', 'aria-label': 'Refresh', title: 'Refresh (R)', disabled: status.busy ? '' : undefined }, glyph('refresh')), { on: { click: 'refresh' } })),

    state.online ? h('section', { class: 'panel-section inference-section', 'aria-label': 'Inference' },
      h('h2', {}, 'INFERENCE'), h('div', { class: 'info-rows' }, pair('Model', data.model), pair('Prompt', data.prompt), pair('Draft', data.draft), pair('Speed', data.speed)),
      meter('Context', data.context, data.fraction, 'normal', state.generating)) : null,

    h('section', { class: 'panel-section', 'aria-label': 'Memory' }, h('h2', {}, 'MEMORY'),
      h('div', { class: 'ram-reading' }, pair('RAM', memory.ram),
        h('div', { class: 'stacked-meter', 'aria-label': `RAM ${memory.ram}` },
          h('div', { class: 'stacked-track' }, each(memory.segments, segment => segment.key, (segment, index) => h('span', { style: `width:${memory.total > 0 ? clamp01(segment.value / memory.total) * 100 : 0}%;background:${colors[index]}` }))),
          memory.gttCap > 0 && memory.gttCap < 1 ? h('i', { class: 'gtt-marker', style: `left:${memory.gttCap * 100}%`, title: memory.gttCaption }) : null),
        memory.segments.length > 0 ? h('div', { class: 'memory-legend' },
          memory.segments.map((segment, index) => segment.value > 0 || segment.key === 'sys' ? h('span', {}, h('i', { style: `background:${colors[index]}` }), `${segment.label} ${segment.value.toFixed(1)}`) : null),
          memory.gttCap > 0 ? h('span', {}, h('i', { class: 'legend-tick' }), memory.gttCaption) : null) : null),
      meter('GTT', memory.gtt, memory.gttRatio, memory.gttRatio >= .9 ? 'urgent' : 'normal'), pair('Swap', memory.swap)),

    h('section', { class: 'panel-section', 'aria-label': 'APU' }, h('h2', {}, 'APU'),
      meter('GPU', hardware.gpu, hardware.gpuFraction, hardware.gpuFraction >= .8 ? 'accent' : 'normal'), meter('Power', hardware.power, hardware.powerFraction), pair('Thermals', hardware.thermals)),

    h('section', { class: 'panel-section', 'aria-label': 'Backend' }, h('h2', {}, 'BACKEND'),
      h('div', { class: 'backend-chips' }, h('span', { class: 'backend-chip', title: 'Backend supplied by your selected container framework' }, status.backend || 'Not prepared')),
      h('div', { class: 'action-row', style: `grid-template-columns:repeat(${state.actions.length}, minmax(0, 1fr))` }, each(state.actions, control => control.key, (control, index) =>
        wire(h('button', { class: control.key === 'down' && state.online ? 'stop-action' : undefined, title: control.tip, disabled: control.enabled ? undefined : '', 'data-cursor': String(cursor?.row === 0 && cursor.index === index) }, glyph(control.key as GlyphName), control.label),
          { on: { click: control.key, pointerenter: `cursor:0:${index}` } }))),
      status.error ? h('p', { class: 'control-caption control-error', role: 'alert' }, status.error)
        : h('p', { class: 'control-caption' }, `${state.online ? 'Restart replaces the running engine and interrupts requests. ' : ''}S start · D stop · G logs · R refresh`)),

    h('nav', { class: 'panel-tools', 'aria-label': 'PAIN tools' },
      wire(h('button', { 'data-cursor': String(cursor?.row === 1 && cursor.index === 0) }, 'Models'), { on: { click: 'models', pointerenter: 'cursor:1:0' } }),
      wire(h('button', { 'data-cursor': String(cursor?.row === 1 && cursor.index === 1) }, 'Getting Started'), { on: { click: 'getting-started', pointerenter: 'cursor:1:1' } })),
  );
}
