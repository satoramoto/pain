import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:560,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  for(const renderer of ['tauri','omarchy']) for(const state of ['offline','ready','generating','starting','failure']) {
    await page.goto(`http://127.0.0.1:6016/iframe.html?id=tray-${renderer}--${state}&viewMode=story`);
    if(renderer==='tauri') {
      await expect(page.getByRole('heading',{name:'PAIN',exact:true})).toBeVisible();
      if(state==='offline') {await expect(page.getByRole('button',{name:'Start',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();}
      if(state==='starting') await expect(page.getByRole('button',{name:'Start',exact:true})).toBeDisabled();
      if(state==='generating') await expect(page.getByText('24.5 tok/s')).toBeVisible();
      if(state==='failure') await expect(page.getByRole('alert')).toContainText('No VirtGPU Metal');
    } else {
      await expect(page.getByRole('img')).toBeVisible();
      await page.getByRole('img').evaluate(img=>img.decode());
    }
    mkdirSync('../.build/ui-checks',{recursive:true});
    await page.screenshot({path:`../.build/ui-checks/${renderer}-${state}.png`,fullPage:true});
    console.log(`PASS ${renderer}/${state}`);
  }
  if(errors.length) throw new Error(errors.join('\n'));
} finally {await browser.close();}
