import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 const headers = page.locator('.setup-section-heading');
 await expect(headers).toHaveCount(5);
 for (const header of await headers.all()) await expect(header).toHaveAttribute('aria-expanded','false');
 const camera = await page.locator('#camera-view').elementHandle();
 const save = async () => {
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  return JSON.parse(await readFile(await (await download).path(),'utf8'));
 };
 const before = await save();
 await page.getByRole('button',{name:'Your robot',exact:true}).click();
 await expect(page.getByLabel('Robot',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'AI model',exact:true}).click();
 await expect(page.getByLabel('Robot',{exact:true})).toBeHidden();
 await expect(page.getByRole('combobox',{name:'AI model',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sensors',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'AI model',exact:true})).toBeHidden();
 await expect(page.getByRole('region',{name:'Finch Sensors',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
 await expect(page.locator('#diagnostics-panel .event-log')).toBeVisible();
 await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
 const after = await save();
 expect(after.rules).toEqual(before.rules);
 expect(after.sensorConfiguration).toEqual(before.sensorConfiguration);
 expect(after).not.toHaveProperty('setupOpen');
 expect(await camera.evaluate(el=>el === document.querySelector('#camera-view'))).toBe(true);
 await page.getByRole('navigation',{name:'Setup steps'}).getByRole('button',{name:'Load AI model'}).click();
 await expect(page.getByRole('button',{name:'AI model',exact:true})).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'AI model',exact:true}).click();
 await mkdir('test-results',{recursive:true});
 for(const [width,height] of [[1440,900],[1920,1080],[1152,768],[390,844]]) {
  await page.setViewportSize({width,height});
  await page.locator('.vision-column').evaluate(el=>el.scrollTop=0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/accordion-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.theme-toggle').click();
 await page.screenshot({path:'test-results/accordion-dark.png'});
 console.log('Accordion checks passed: five collapsed defaults, one-open behavior, mounted camera, unchanged project data, setup navigation, diagnostics/log grouping, responsive themes.');
} finally { await browser.close(); }
