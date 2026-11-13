import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:560,height:1000}});
  if (process.argv.includes('--static')) {
    const root = resolve('storybook-static');
    const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
    await page.route('http://pain.test/**', route => {
      const path = resolve(root, '.' + new URL(route.request().url()).pathname);
      if (!path.startsWith(root + '/')) return route.abort();
      try { return route.fulfill({body:readFileSync(path),contentType:mime[extname(path)] || 'application/octet-stream'}); }
      catch { return route.fulfill({status:404,body:'Not found'}); }
    });
  }
  const origin = process.argv.includes('--static') ? 'http://pain.test' : 'http://localhost:6016';
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  for(const renderer of ['tauri','omarchy']) for(const state of ['offline','ready','generating','starting','failure']) {
    await page.goto(`${origin}/iframe.html?id=tray-${renderer}--${state}&viewMode=story`);
    if(renderer==='tauri') {
      await expect(page.getByRole('heading',{name:'PAIN',exact:true})).toBeVisible();
      if(state==='offline') {await expect(page.getByRole('button',{name:'Start',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveAttribute('aria-disabled','true');}
      if(state==='starting') await expect(page.getByRole('button',{name:'Starting…',exact:true})).toHaveAttribute('aria-disabled','true');
      if(state==='generating') await expect(page.getByText('24.5 tok/s').first()).toBeVisible();
      if(state==='failure') await expect(page.getByRole('alert')).toContainText('No VirtGPU Metal');
    } else {
      await expect(page.getByRole('img')).toBeVisible();
      await page.getByRole('img').evaluate(img=>img.decode());
    }
    mkdirSync('../.build/ui-checks',{recursive:true});
    await page.screenshot({path:`../.build/ui-checks/${renderer}-${state}.png`,fullPage:true});
    console.log(`PASS ${renderer}/${state}`);
  }
  for (const state of ['welcome','installing','docker']) {
    await page.setViewportSize({width:460,height:650});
    await page.goto(`${origin}/iframe.html?id=help-getting-started--${state}&viewMode=story`);
    await expect(page.getByRole('heading',{name:'Your Mac. Your models.'})).toBeVisible();
    await page.screenshot({path:`../.build/ui-checks/onboarding-${state}.png`,fullPage:true});
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Onboarding overflows the window');
    console.log(`PASS onboarding/${state} screenshot and narrow layout`);
  }
  if(errors.length) throw new Error(errors.join('\n'));
} finally {await browser.close();}
