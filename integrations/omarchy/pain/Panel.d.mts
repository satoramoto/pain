import type { Element } from './.generated/ui.mjs';
export interface UIState { platform?: 'mac' | 'omarchy'; selectedBackend?: string; cursor?: string; removeId?: string }
export function view(status: object, ui?: UIState): Element;
export function guide(status: object, ui?: UIState): Element;
export function controlRows(tree: Element): Element[][];
