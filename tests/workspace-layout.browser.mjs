import { openSetup } from './setup-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5174');
await mkdir('test-results',{recursive:true});
const stage = page.locator('#camera-view');
const compactHeight = (await stage.boundingBox()).height;
const sourceBefore = await page.getByLabel('Camera Source',{exact:true}).inputValue();
await page.getByRole('button',{name:'Expand camera',exact:true}).click();
expect((await stage.boundingBox()).height).toBeGreaterThan(compactHeight);
await page.getByRole('button',{name:'Collapse camera',exact:true}).click();
expect((await stage.boundingBox()).height).toBe(compactHeight);
expect(await page.getByLabel('Camera Source',{exact:true}).inputValue()).toBe(sourceBefore);

for(const [width,height] of [[1152,768],[1366,768],[1440,900],[1920,1080],[390,844]]) {
 await page.setViewportSize({width,height});
 await page.screenshot({path:`test-results/workspace-${width}.png`,fullPage:true});
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 if(width > 1050) {
  expect((await page.locator('.rules-controls').boundingBox()).y).toBeLessThan(height - 100);
  const geometry = await page.evaluate(() => {
   const rail = document.querySelector('.vision-column');
   const rules = document.querySelector('.rules-section');
   const workspace = document.querySelector('.studio-grid').getBoundingClientRect();
   const stop = document.querySelector('.safety-bar').getBoundingClientRect();
   rail.scrollTop = 150;
   const result = {page:document.documentElement.scrollHeight, height:innerHeight,
    railScrolled:rail.scrollTop, railOverflow:rail.scrollHeight > rail.clientHeight, rulesScrolled:rules.scrollTop,
    bottom:workspace.bottom, stopTop:stop.top,
    rulesBottom:rules.getBoundingClientRect().bottom,
    ratio:rail.getBoundingClientRect().width / workspace.width};
   rail.scrollTop = 0;
   return result;
  });
  expect(geometry.page).toBeLessThanOrEqual(geometry.height + 1);
  if (geometry.railOverflow) expect(geometry.railScrolled).toBeGreaterThan(0);
  expect(geometry.rulesScrolled).toBe(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.stopTop);
  expect(Math.abs(geometry.rulesBottom - geometry.bottom)).toBeLessThan(2);
  expect(geometry.ratio).toBeGreaterThan(.32);
  expect(geometry.ratio).toBeLessThan(.38);
 }

 console.log(width,await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,add:document.querySelector('.rules-controls').getBoundingClientRect().y,camera:document.querySelector('.camera-panel').getBoundingClientRect().width})));
}
await page.setViewportSize({width:1440,height:900});
await page.locator('.rule-card').first().getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('button',{name:'Add rule',exact:true}).click();
await page.locator('.rule-card').nth(1).getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('button',{name:'Add rule',exact:true}).click();
await page.locator('.rule-card').nth(2).getByRole('button',{name:'Done',exact:true}).click();
await page.evaluate(()=>scrollTo(0,0));
await page.screenshot({path:'test-results/workspace-collapsed.png'});
await page.locator('.theme-toggle').click();
await page.screenshot({path:'test-results/workspace-dark.png'});
await page.locator('.rule-card').first().getByRole('button',{name:'Edit',exact:true}).click();
await expect(page.getByLabel('Condition source').first()).toBeVisible();
await page.getByLabel('Delete rule 3').click();
await expect(page.locator('.rule-card')).toHaveCount(2);
await page.locator('.rule-card').first().getByRole('checkbox',{name:'Enabled',exact:true}).uncheck();
await expect(page.locator('.rule-card').first()).toHaveClass(/disabled-rule/);
  await openSetup(page, 'Your robot');
await page.getByText('Hardware tests & reset',{exact:true}).click();
await expect(page.getByRole('button',{name:'GREEN BEAK',exact:true})).toBeVisible();
  await openSetup(page, 'AI model');
await page.getByText('Advanced vision settings',{exact:true}).click();
await expect(page.getByLabel('Inference FPS')).toBeVisible();
await page.getByLabel('Action 1 type',{exact:true}).first().selectOption('move');
await page.getByLabel('Action 1 movement mode',{exact:true}).first().selectOption('follow');
await page.getByLabel('Camera Source',{exact:true}).selectOption('network');
await expect(page.getByLabel('Stream URL')).toBeVisible();
for(const width of [1366,390]) {
 await page.setViewportSize({width,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
console.log('Layout, themes, rule editing/collapse, relocated controls and network/Follow UI passed.');
} finally { await browser.close(); }
