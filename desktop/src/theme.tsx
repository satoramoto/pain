import type { ReactNode } from 'react';
import { Surface, ThemeScope, resolveTheme } from './zen';

// Same scope and transparent ground as visual[flow]'s app frame. The native
// window supplies HUD frost; Zen owns the glass, type, contrast, and controls.
const visuals = resolveTheme({ theme: 'visuals' });
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

export function ThemeFrame({ children }: { children: ReactNode }) {
  return <ThemeScope facets={facets} principles={visuals.pack.principles} mode="system" bleed>
    <Surface layer="ground" className="pain-window">{children}</Surface>
  </ThemeScope>;
}
