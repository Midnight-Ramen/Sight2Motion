import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
await page.route('http://127.0.0.1:30061/**', r => r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 await page.getByRole('button',{name:'Add rule',exact:true}).click();
 const rule = page.locator('.rule-card').last();
 await rule.getByText('Timing & trigger settings',{exact:true}).click();
 await expect(rule.locator('.timing select')).toHaveValue('continuous');
 for (const width of [1366,1440,1920]) {
  await page.setViewportSize({width,height:900});
  const geometry = await page.evaluate(() => {
   const box = s => document.querySelector(s).getBoundingClientRect();
   return {gap:box('.rule-card').top-box('#play-blocker').bottom,
    aligned:Math.abs(box('.section-heading h2').top-box('.rules-status').top),
    right:box('.rules-controls').right, headerRight:box('.rules-section > .section-heading').right};
  });
  expect(geometry.gap).toBeGreaterThanOrEqual(8);
  expect(geometry.gap).toBeLessThanOrEqual(8);
  expect(geometry.aligned).toBeLessThan(10);
  expect(Math.abs(geometry.right-geometry.headerRight)).toBeLessThan(2);
 }
 console.log('Rules header geometry and new-rule trigger passed.');
} finally {await browser.close();}
