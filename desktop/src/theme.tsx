import type { ReactNode } from 'react';
import { Surface, ThemeScope, resolveTheme } from './zen';

// Same scope and transparent ground as visual[flow]'s app frame. The native
// window supplies HUD frost; Zen owns the glass, type, contrast, and controls.
const visuals = resolveTheme({ theme: 'visuals' });

export function ThemeFrame({ children }: { children: ReactNode }) {
  return <ThemeScope facets={visuals.facets} principles={visuals.pack.principles} mode="system" bleed>
    <Surface layer="ground" className="pain-window">{children}</Surface>
  </ThemeScope>;
}
