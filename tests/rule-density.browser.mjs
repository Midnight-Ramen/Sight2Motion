import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 for(const width of [1366,1440,1920,800,390]) {
  await page.setViewportSize({width,height:900});
  const result=await page.evaluate(()=>{
   const b=s=>document.querySelector(s).getBoundingClientRect();
   const boxes=[...document.querySelectorAll('.condition > .sentence select, .spatial-controls select')].map(e=>e.getBoundingClientRect());
   return {height:b('.rule-card').height,overflow:document.documentElement.scrollWidth>innerWidth,
    overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)),
    iconRight:b('.action-icon').right,fieldsLeft:b('.action-fields').left,
    condition:b('.condition').height,actions:b('.actions').height};
  });
  expect(result.overlap).toBe(false);expect(result.overflow).toBe(false);
  expect(result.fieldsLeft).toBeGreaterThanOrEqual(result.iconRight);
  expect(result.actions).toBeLessThan(result.condition);
  if(width===1440){expect(result.height).toBeLessThanOrEqual(288);console.log('Basic expanded rule height:',result.height,'px; previous: 360px');}
 }
 await page.locator('.condition-footer summary').click();
 await page.locator('.timing select').selectOption('interval');
 await expect(page.locator('.trigger-pill')).toContainText('Every interval');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.locator('.rule-body')).not.toBeVisible();
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.locator('.timing select')).toHaveValue('interval');
 console.log('Density, non-overlap, wrapping, footer editing and collapse checks passed.');
}finally{await browser.close();}

