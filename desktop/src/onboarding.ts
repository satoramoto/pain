export type Framework = 'podman' | 'docker';
export const steps = [
  ['dependencies', 'Install the essentials', 'Reuse your container runtime, or install it. Everything else stays inside pain(less).'],
  ['machine', 'Prepare your workspace', 'Boot the virtual machine and prepare the inference tools.'],
  ['model', 'Download a starter model', 'Qwen3 4B · Q4_K_M · about 2.5 GB. A small starting point; add larger models later.'],
  ['engine', 'Start local inference', 'Start llama.cpp and check that it answers on localhost:11434.'],
  ['opencode', 'Connect OpenCode', 'Reuse OpenCode or install a private copy, then create a separate pain(less) configuration.'],
] as const;
export type Step = typeof steps[number][0];
export interface SetupState { framework: Framework; running: boolean; completed: Step[]; current?: Step; error?: string; done?: boolean; }
export const initialSetup = (): SetupState => ({framework:'podman',running:false,completed:[]});
export async function runSetup(state: SetupState, execute: (step: Step, framework: Framework) => Promise<unknown>, update: () => void) {
  if (state.running) return;
  state.running = true; state.error = ''; state.done = false;
  try {
    for (const [step] of steps) {
      if (state.completed.includes(step)) continue;
      state.current = step; update();
      await execute(step, state.framework);
      state.completed.push(step); update();
    }
    state.current = undefined; state.done = true;
  } catch (error) { state.error = String(error); }
  finally { state.running = false; update(); }
}
export function onboarding(state: SetupState, start: () => void, change: (framework: Framework) => void, close: () => void, launch: () => void) {
  const el = document.createElement('section'); el.className = 'onboarding';
  el.innerHTML = `<header><span class="mark" aria-hidden="true">◈</span><span class="eyebrow">pain(less) / GETTING STARTED</span></header>
    <h1>Your Mac.<br>Your models.</h1><p class="intro">A private AI workspace, ready when you are.</p>
    <p class="explanation">Making agentic coding with local AI as painless as possible. pain(less) runs llama.cpp in a container. Your models stay on your Mac; OpenCode connects to it locally to help you work on code.</p>
    <fieldset><legend>Choose your container framework</legend>
      <label class="choice"><input type="radio" name="framework" value="podman"><span><b>Podman <em>Recommended</em></b><small>Apple GPU · experimental Metal acceleration</small></span></label>
      <label class="choice"><input type="radio" name="framework" value="docker"><span><b>Docker Desktop</b><small>CPU only on Mac · slower, uses your existing Docker setup</small></span></label>
    </fieldset><div class="setup-status" aria-live="polite" role="status"></div><div class="setup-error"></div><div class="setup-actions"></div><p class="setup-note">${state.framework === 'podman' ? 'Defaults: 4 CPUs, 8 GB VM memory, 60 GB expandable disk. Metal support is experimental.' : 'Docker runs llama.cpp on the CPU. Docker Desktop may ask you to accept its terms and finish first-run setup.'} Allow several GB of downloads and a few minutes. macOS may ask for administrator approval.</p>
    <ol class="setup-steps"></ol><p class="footnote">No Homebrew, Python or Node installation needed. Existing OpenCode settings stay intact. Setup can be reopened from Help → Getting Started.</p>`;
  el.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = input.value === state.framework; input.disabled = state.running; input.onchange = () => change(input.value as Framework); });
  const list = el.querySelector('ol')!;
  for (const [id, title, detail] of steps) {
    const complete = state.completed.includes(id); const active = !complete && state.current === id;
    const row = document.createElement('li'); row.className = complete ? 'complete' : active ? 'active' : '';
    const label = document.createElement('b'); label.textContent = title;
    const description = document.createElement('p'); description.textContent = detail;
    const indicator = document.createElement('span'); indicator.className = 'step-indicator'; indicator.textContent = complete ? '✓' : String(steps.findIndex(s => s[0] === id) + 1);
    row.append(indicator, label, description); list.append(row);
  }
  el.querySelector('.setup-status')!.textContent = state.done ? 'You’re ready. OpenCode is connected to your local model.' : state.running ? `Working: ${steps.find(s => s[0] === state.current)?.[1]}… You can leave this window open.` : 'One click sets up all five steps.';
  if (state.error) { const alert = document.createElement('p'); alert.className = 'error'; alert.setAttribute('role','alert'); alert.textContent = state.error; el.querySelector('.setup-error')!.append(alert); }
  const actions = el.querySelector('.setup-actions')!;
  const primary = document.createElement('button'); primary.className = 'primary'; primary.textContent = state.done ? 'Open OpenCode' : state.running ? 'Setting up…' : state.error ? 'Retry this step' : 'Set up my Mac'; primary.disabled = state.running; primary.onclick = state.done ? launch : start;
  const back = document.createElement('button'); back.textContent = 'Back to dashboard'; back.disabled = state.running; back.onclick = close;
  actions.append(primary,back); return el;
}
