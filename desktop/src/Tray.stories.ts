import { domStory } from './story-dom';
import { expect, fn, userEvent, within } from 'storybook/test';
import { scenario } from 'story-spec';
import { panel } from './panel';
import { fixtures } from './fixtures';
const onAction = fn();
export default {title:'Tray/Tauri',parameters:{spec:{capability:'desktop-tray',requirement:'Control the local inference engine',shall:'The tray SHALL report engine state and allow available actions.'}}};
export const Offline = scenario({when:'The engine is offline',then:'Start is available and Stop is disabled',check:async ({canvasElement})=>{const c=within(canvasElement);await expect(c.getByRole('button',{name:'Start'})).toBeEnabled();const stop=c.getByRole('button',{name:'Stop'});await expect(stop).toHaveAttribute('aria-disabled','true');onAction.mockClear();await userEvent.click(stop);await expect(onAction).not.toHaveBeenCalled();}},{render:()=>domStory(panel(fixtures.offline,onAction))});
export const Ready = scenario({when:'The engine is ready',then:'The model name and restart action are visible',check:async ({canvasElement})=>{const c=within(canvasElement);await expect(c.getByText('local-default')).toBeVisible();await expect(c.getByRole('button',{name:'Restart'})).toBeEnabled();}},{render:()=>domStory(panel(fixtures.ready,onAction))});
export const Generating = scenario({when:'The engine generates tokens',then:'Context use and speed are shown',check:async ({canvasElement})=>{for(const reading of within(canvasElement).getAllByText('24.5 tok/s')) await expect(reading).toBeVisible();}},{render:()=>domStory(panel(fixtures.generating,onAction))});
export const Starting = scenario({when:'The engine is starting',then:'Start is disabled until the operation finishes',check:async ({canvasElement})=>{const start=within(canvasElement).getByRole('button',{name:'Starting…'});await expect(start).toHaveAttribute('aria-disabled','true');onAction.mockClear();await userEvent.click(start);await expect(onAction).not.toHaveBeenCalled();}},{render:()=>domStory(panel(fixtures.starting,onAction))});
export const Failure = scenario({when:'Metal is unavailable',then:'The actionable failure is visible',check:async ({canvasElement})=>{await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('No VirtGPU Metal device');}},{render:()=>domStory(panel(fixtures.failure,onAction))});

export const CompactToolbar = scenario({
  when:'The compact toolbar is used',
  then:'Help opens from the question mark and letter shortcuts do not control the engine',
  check:async ({canvasElement})=>{
    const c=within(canvasElement);
    await expect(c.queryByRole('combobox',{name:'Theme'})).toBeNull();
    onAction.mockClear();
    await userEvent.click(c.getByRole('button',{name:'?'}));
    await expect(onAction).toHaveBeenCalledWith('getting-started',undefined);
    onAction.mockClear();
    await userEvent.keyboard('sdgr');
    await expect(onAction).not.toHaveBeenCalled();
    await expect(c.getByRole('tab',{name:'Dashboard'})).toHaveAttribute('aria-selected','true');
  },
},{render:()=>domStory(panel(fixtures.offline,onAction))});
