import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5174');await page.getByRole('button',{name:'Your robot',exact:true}).click();
 const manual=page.getByRole('region',{name:'Manual Drive',exact:true});
 await expect(manual.getByRole('button',{name:'Drive forward',exact:true})).toBeVisible();
 await expect(page.getByLabel('Keep Distance target cm')).toHaveCount(0);
 for(const name of ['Keep Distance','Drive Until','Line Follow']){
  await page.getByRole('button',{name:'+ Add behavior',exact:true}).click();await page.getByLabel('Add behavior',{exact:true}).selectOption(name);
  await expect(page.getByLabel(name+' controls',{exact:true})).toBeVisible();
 }
 await page.getByLabel('Keep Distance target cm').fill('32');
 await page.getByRole('button',{name:'Hide Keep Distance',exact:true}).click();
 await expect(page.getByLabel('Keep Distance target cm')).toHaveCount(0);
 await page.getByRole('button',{name:'+ Add behavior',exact:true}).click();await page.getByLabel('Add behavior',{exact:true}).selectOption('Keep Distance');
 await expect(page.getByLabel('Keep Distance target cm')).toHaveValue('32');
 for(const width of [1440,1920,700]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});await manual.screenshot({path:'test-results/drive-workspace.png'});
 console.log('Progressive disclosure: hidden defaults, grouped selection, multiple cards, retained configuration, manual controls, responsive overflow checks passed.');
}finally{await browser.close();}
