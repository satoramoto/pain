export interface UpdateState {
  phase: 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'restart' | 'error';
  version?: string;
  notes?: string;
  received?: number;
  total?: number;
  error?: string;
}
export function updates(state: UpdateState, install: () => void, retry: () => void, close: () => void) {
  const el = document.createElement('section'); el.className = 'onboarding';
  el.innerHTML = `<header><span class="eyebrow">pain(less) / UPDATES</span></header><h1>Keep pain(less)<br>up to date.</h1>
    <p class="intro" role="status" aria-live="polite"></p><p class="update-notes"></p><p class="setup-error" role="alert"></p><div class="setup-actions"></div>
    <p class="footnote">Updates come from signed pain(less) releases. Install pain(less) in Applications before updating. Your models and settings stay on this Mac. The app restarts; inference keeps running. For runtime upgrades, stop the dedicated VM and rerun Getting Started.</p>`;
  const labels = {checking:'Checking for updates…', current:'You’re up to date.', available:`pain(less) ${state.version} is available.`, downloading:`Downloading… ${state.total ? Math.min(100, Math.round((state.received || 0) / state.total * 100)) + '%' : Math.round((state.received || 0) / 1024 / 1024) + ' MB'}`, installing:'Verifying and installing…', restart:'Installed. Restart pain(less) to finish.', error:'Could not update pain(less).'};
  el.querySelector('[role=status]')!.textContent = labels[state.phase];
  el.querySelector('.update-notes')!.textContent = state.notes || '';
  el.querySelector('[role=alert]')!.textContent = state.error || '';
  const actions = el.querySelector('.setup-actions')!;
  const button = (text: string, click: () => void) => {const b=document.createElement('button');b.textContent=text;b.onclick=click;actions.append(b);};
  if (state.phase === 'available') button('Install and restart', install);
  if (state.phase === 'restart') button('Restart pain(less)', install);
  if (state.phase === 'error' || state.phase === 'current') button('Check again', retry);
  if (!['downloading','installing','restart'].includes(state.phase)) button('Back to pain(less)', close);
  return el;
}
