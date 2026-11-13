export interface AppState {
  screen: 'dashboard' | 'models' | 'logs';
  removeId: string;
  url: string;
  folder: string;
  cursor: { row: number; index: number } | null;
}
export interface Effect { action: string; payload?: unknown }
export const tabs: { id: AppState['screen']; label: string }[];
export function initialState(status?: { modelsDir?: string }): AppState;
export function transition(current: AppState, status: object, action: string, payload?: unknown, logs?: { state: string }): { state: AppState; effects: Effect[] };
