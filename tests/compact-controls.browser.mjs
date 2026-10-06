import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
await page.route('http://127.0.0.1:30061/**', r => r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 const geometry=await page.evaluate(()=>{
  const b=s=>document.querySelector(s).getBoundingClientRect();
  return {mirror:b('.mirror-control'), checkbox:b('.mirror-control input'), icon:b('.action-icon'), fields:b('.action-fields'), color:b('.color-field'), title:b('.action-fields > select'), gap:b('.rule-card').top-b('#play-blocker').bottom};
 });
 expect(geometry.checkbox.y).toBeGreaterThanOrEqual(geometry.mirror.y);
 expect(geometry.checkbox.bottom).toBeLessThanOrEqual(geometry.mirror.bottom);
 expect(geometry.fields.x).toBeGreaterThanOrEqual(geometry.icon.right);
 expect(geometry.color.y).toBeGreaterThanOrEqual(geometry.title.bottom);
 expect(geometry.gap).toBeLessThanOrEqual(8);
 await page.getByLabel('Action 1 type',{exact:true}).selectOption('move');
 const slider=page.getByRole('slider',{name:'Speed % slider',exact:true});
 const number=page.getByRole('spinbutton',{name:'Speed %',exact:true});
 await number.fill('40');
 await expect(slider).toHaveValue('40');
 await slider.scrollIntoViewIfNeeded();
 const b=await slider.boundingBox();
 await page.mouse.move(b.x+b.width*.4,b.y+b.height/2);
 await page.mouse.down();
 await page.mouse.move(b.x+b.width*.6,b.y+b.height/2,{steps:8});
 const mid=Number(await slider.inputValue());
 await page.mouse.move(b.x+b.width*.8,b.y+b.height/2,{steps:8});
 const end=Number(await slider.inputValue());
 await page.mouse.up();
 expect(mid).toBeGreaterThan(45);
 expect(end).toBeGreaterThan(mid);
 await expect(number).toHaveValue(String(end));
 await slider.focus(); await page.keyboard.press('ArrowLeft');
 await expect(number).toHaveValue(String(end-1));
 console.log('Mirror/action layout, native continuous drag, numeric sync and keyboard passed.');
} finally {await browser.close();}
