import type { Element } from './.generated/ui.mjs';
export interface UIState { platform?: 'mac' | 'omarchy'; selectedBackend?: string; cursor?: string; removeId?: string }
export function actions(status: object, ui?: UIState): { key: string; label: string; disabled: boolean }[];
export function view(status: object, ui?: UIState): Element;
export function controlRows(tree: Element): Element[][];
