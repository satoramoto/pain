import {chromium,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
if(!process.argv[2])throw new Error('Usage: node check-comfy-downloads.mjs /path/to/H3-workflow.json');
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
const requests=[];
await page.route('**/painless/downloads',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  await route.fulfill({json:{id:'qa',name:body.name,directory:body.directory,status:'complete',received:1,total:1}});
});
try {
 await page.goto('http://127.0.0.1:8188');
 await page.waitForFunction(()=>typeof window.__comfyDesktop2?.downloadModel==='function');
 const workflow=JSON.parse(readFileSync(process.argv[2],'utf8'));
 await page.evaluate(async workflow=>{const {app}=await import('/scripts/app.js');await app.loadGraphData(workflow);},workflow);
 await page.getByText('Issues',{exact:true}).click();
 await expect(page.locator('[data-testid="missing-model-download"]').first()).toBeVisible();
 const buttons=page.locator('[data-testid="missing-model-download"]');
 console.log('buttons',await buttons.count());

 {
  await buttons.first().click();
  await expect.poll(()=>requests.length).toBeGreaterThan(0);
  if(!requests[0].directory || !requests[0].url || !requests[0].name)throw new Error('Missing download metadata');
  console.log('PASS real Download button dispatched',JSON.stringify(requests[0]));
 }
 await page.screenshot({path:'../.build/ui-checks/comfy-download.png'});
 if(errors.length)throw new Error(errors.join('\n'));
} finally {await browser.close();}
