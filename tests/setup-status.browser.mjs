import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({deviceScaleFactor:1});
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174/');
 await expect(page.locator('main .workflow')).toHaveCount(0);
 await expect(page.locator('main > nav')).toHaveCount(0);
 const bar=page.locator('.safety-bar');
 await expect(bar.getByRole('button',{name:'Play rules',exact:true})).toBeDisabled();
 await expect(page.locator('.setup-popover')).not.toBeVisible();
 await page.locator('.setup-status summary').click();
 await expect(page.getByRole('navigation',{name:'Setup steps'})).toBeVisible();
 await expect(page.locator('.setup-popover button')).toHaveCount(5);
 await page.locator('.setup-popover').getByRole('button',{name:'Load AI model',exact:true}).click();
 await expect(page.locator('.setup-popover')).not.toBeVisible();
 await expect(page.getByRole('combobox',{name:'AI vision',exact:true})).toBeVisible();
 for(const width of [1366,1440,1920,700,390,320]) {
  await page.setViewportSize({width,height:900});
  const result=await bar.evaluate(el=>{
   const b=el.getBoundingClientRect();const r=s=>{const t=el.querySelector(s).getBoundingClientRect();return {left:t.left,right:t.right,center:t.left+t.width/2};};
   return {bottom:b.bottom,status:r('.setup-status'),play:r('.primary'),stop:r('.stop-button'),overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth};
  });
  expect(result.overflow).toBe(false);expect(result.bottom).toBeCloseTo(900,0);
  expect(result.status.left).toBeGreaterThanOrEqual(result.play.right);
  expect(result.status.right).toBeLessThanOrEqual(result.stop.left);
  if(width>850)expect(Math.abs(result.status.center-width/2)).toBeLessThanOrEqual(1);
  else await expect(page.locator('.setup-status-short')).toBeVisible();
  console.log(`${width}px: bottom status, Play left/STOP right and responsive layout passed`);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.setup-status summary').click();
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/bottom-setup-status.png'});
}finally{await browser.close();}
