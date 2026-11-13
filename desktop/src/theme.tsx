import { appearanceFor } from '../../integrations/omarchy/pain/Appearance.mjs';
import type { ReactNode } from 'react';
import { Surface, ThemeScope } from './zen';

import { resolveApplicationTheme } from '@satoramoto/zen/harness/omarchy/bench/application-theme.ts';

// Same scope and transparent ground as visual[flow]'s app frame. The native
// window supplies HUD frost; Zen owns the glass, type, contrast, and controls.
const visuals = resolveApplicationTheme('visuals');
const layers = visuals.facets.materials.layers;
const facets = {
  ...visuals.facets,
  materials: {
    ...visuals.facets.materials,
    layers: {
      ...layers,
      // Keep Zen's solid tones, blur and ink; ease the sheet floor from 62% to
      // 56%. Its reduced-transparency rules can still select the solid tones.
      raised: { ...layers.raised, fill: 'color-mix(in oklab, var(--layer-raised-solid) 56%, transparent)' },
      float: { ...layers.float, fill: 'color-mix(in oklab, var(--layer-float-solid) 56%, transparent)' },
    },
  },
};

export function ThemeFrame({ children, appearance }: { children: ReactNode; appearance?: string }) {
  let selected = appearance;
  if (!selected) {
    try { selected = appearanceFor(localStorage.getItem('pain.appearance'), 'mac'); } catch { selected = 'visuals'; }
  }
  const chosen = resolveApplicationTheme(selected || 'visuals');
  return <ThemeScope facets={selected === 'visuals' ? facets : chosen.facets} principles={chosen.pack.principles} mode="system" bleed>
    <Surface layer="ground" className="pain-window">{children}</Surface>
  </ThemeScope>;
}
