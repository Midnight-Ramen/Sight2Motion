import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.route('http://127.0.0.1:30061/**', route => route.fulfill({ body: 'false' }));
try {
 await page.goto('http://127.0.0.1:5174/');
 for (const width of [1366,1440,1920,700,390]) {
  await page.setViewportSize({width,height:900});
  for (const mode of ['None','Cruise Forward','Line Follow','Keep Distance']) {
   await page.getByLabel('Base driving behavior',{exact:true}).selectOption(mode);
   const result = await page.locator('.base-driving').evaluate(el => {
    const r = el.getBoundingClientRect();
    const controls = [...el.querySelectorAll('.base-strip select,.base-strip input[type=number]')].filter(e=>e.checkVisibility()).map(e=>{const b=e.getBoundingClientRect();return b.top+b.height/2;});
    return {height:r.height, centers:controls, overflow:document.documentElement.scrollWidth>innerWidth,text:el.innerText};
   });
   expect(result.overflow).toBe(false);
   expect(result.text).not.toContain('Check connection and sensor readings');
   await expect(page.locator('.base-driving')).not.toContainText('Safety');
   if(width<600) expect(new Set(result.centers.map(y=>Math.round(y))).size).toBeLessThanOrEqual(2);
   if(width>=1366) { expect(Math.max(...result.centers)-Math.min(...result.centers)).toBeLessThanOrEqual(1); expect(result.height).toBeLessThanOrEqual(65); }
   if(mode==='Line Follow'||mode==='Keep Distance') {
    await page.locator('.base-more-settings > summary').click();
    await expect(page.getByLabel(mode==='Line Follow'?'Line marker action':'Keep Distance target cm')).toBeVisible();
    await page.locator('.base-more-settings > summary').click();
   }
  }
  console.log(`${width}px compact controls and relevant settings passed`);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByLabel('Base driving behavior',{exact:true}).selectOption('Cruise Forward');
 mkdirSync('test-results',{recursive:true});
 await page.screenshot({path:'test-results/base-strip.png'});
} finally {await browser.close();}
