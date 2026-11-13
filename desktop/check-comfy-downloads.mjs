import {chromium,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
if(!process.argv[2])throw new Error('Usage: node check-comfy-downloads.mjs /path/to/H3-workflow.json');
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
const requests=[];
let job=null, cancellations=0, removals=0;
await page.route('**/painless/downloads',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:job?[job]:[]});
  const body=route.request().postDataJSON();requests.push(body);
  job={...body,id:'qa',status:'downloading',received:100,total:1000};
  await route.fulfill({json:job});
});
await page.route('**/painless/downloads/qa/cancel',route=>{cancellations++;job.status='paused';return route.fulfill({json:job});});
await page.route('**/painless/downloads/qa',route=>{removals++;job=null;return route.fulfill({json:{removed:true}});});
try {
 await page.goto('http://127.0.0.1:8188');
 await page.waitForFunction(()=>typeof window.__comfyDesktop2?.downloadModel==='function');
 const workflow=JSON.parse(readFileSync(process.argv[2],'utf8'));
 await page.evaluate(async workflow=>{const {app}=await import('/scripts/app.js');await app.loadGraphData(workflow);},workflow);
 await page.getByTestId('panel-tab-errors').click();
 await expect(page.locator('[data-testid="missing-model-download"]').first()).toBeVisible();
 const buttons=page.locator('[data-testid="missing-model-download"]');
 console.log('buttons',await buttons.count());

 {
  await buttons.first().click();
  await expect.poll(()=>requests.length).toBeGreaterThan(0);
  if(!requests[0].directory || !requests[0].url || !requests[0].name)throw new Error('Missing download metadata');
  console.log('PASS real Download button dispatched',JSON.stringify(requests[0]));
 }
 const manager=page.getByRole('region',{name:'Model downloads'});
 await manager.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(manager.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
 if(cancellations!==1)throw new Error('Cancel did not reach the backend');
 await page.reload();
 await page.getByRole('button',{name:'Downloads (1)',exact:true}).click();
 await expect(manager.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
 if(requests.length!==1)throw new Error('Reload restarted a paused transfer');
 await manager.getByRole('button',{name:'Resume',exact:true}).click();
 await expect(manager.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();
 await manager.getByRole('button',{name:'Cancel',exact:true}).click();
 await manager.getByRole('button',{name:'Remove partial',exact:true}).click();
 if(removals)throw new Error('Partial removed before confirmation');
 await manager.getByRole('button',{name:'Keep file',exact:true}).click();
 await manager.getByRole('button',{name:'Remove partial',exact:true}).click();
 await manager.getByRole('button',{name:'Delete partial file',exact:true}).click();
 await expect(manager.getByText('No downloads.',{exact:true})).toBeVisible();
 if(removals!==1 || requests.length!==2)throw new Error('Unexpected download control requests');
 console.log('PASS cancel, reload recovery, resume and confirmed partial removal');
 await page.screenshot({path:'../.build/ui-checks/comfy-download.png'});
 if(errors.length)throw new Error(errors.join('\n'));
} finally {await browser.close();}
