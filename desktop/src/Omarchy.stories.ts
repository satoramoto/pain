import { expect, within } from 'storybook/test';
import { scenario } from 'story-spec';
export default {title:'Tray/Omarchy',parameters:{spec:{capability:'desktop-tray',requirement:'Inspect the native renderer',shall:'The story catalog SHALL show the real QML panel for the shared engine states.'}}};
const render = (name:string) => () => {
  const figure=document.createElement('figure'); const img=document.createElement('img');
  img.src=`/omarchy/${name}.png`;img.alt=`Omarchy ${name} panel`;img.style.width='440px';
  const caption=document.createElement('figcaption');caption.textContent='Native QML capture — same Widget.qml markup and Omarchy components. Window placement and IPC require native QA.';
  figure.append(img,caption);return figure;
};
function story(name:string) {return scenario({when:`The native tray is ${name}`,then:'The matching QML capture is available',check:async ({canvasElement})=>{const img=within(canvasElement).getByRole('img') as HTMLImageElement;await img.decode();await expect(img.naturalWidth).toBeGreaterThan(0);}},{render:render(name)});}
export const Offline=story('offline');export const Ready=story('ready');export const Generating=story('generating');export const Starting=story('starting');export const Failure=story('failure');
