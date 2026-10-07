import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await p.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await p.goto('http://127.0.0.1:5174');
 expect(await p.locator('.setup-section-heading').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')))).toEqual(['AI model','Your robot','Sensors','Objects for this project','Diagnostics']);
 for(const name of ['Start Camera','Load AI model','Connect robot']) await expect(p.locator('.workflow button').filter({hasText:name}).locator('.step-number')).not.toHaveClass(/done/);
 const type=p.getByLabel('Action 1 type',{exact:true});
 for(const width of [1440,1920]) {
  await p.setViewportSize({width,height:width===1440?900:1080});
  for(const kind of ['tail','tailLightSequence']) {
   await type.selectOption(kind);
   const tops=await p.locator('.tail-led-control').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));
   expect(new Set(tops).size).toBe(1);
   expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await expect(p.locator('.safety-bar').getByRole('button',{name:'Play rules',exact:true})).toBeVisible();
  await expect(p.locator('.safety-bar').getByRole('button',{name:/STOP ROBOT/})).toBeVisible();
 }
 await type.selectOption('tail');
 await p.getByRole('checkbox',{name:'Action 1 tail light 1',exact:true}).check();
 await p.getByLabel('Action 1 tail light 1 color',{exact:true}).fill('#ff0000');
 await p.getByRole('checkbox',{name:'Action 1 tail light 3',exact:true}).check();
 await p.getByLabel('Action 1 tail light 3 color',{exact:true}).fill('#0000ff');
 await expect(p.getByLabel('Action 1 tail light 2 color',{exact:true})).toBeDisabled();
 await expect(p.getByText('Changes ready. Press Play rules to run your updated actions.',{exact:true})).toHaveCount(0);
 const download=p.waitForEvent('download');await p.getByRole('button',{name:'Save project',exact:true}).click();
 const saved=JSON.parse(await readFile(await(await download).path(),'utf8'));
 expect(saved.rules[0].actions[0].tailColors).toEqual({1:'#ff0000',3:'#0000ff'});
 expect(saved.rules[0].actions[0].tailLights).toEqual([1,3]);
 await p.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({name:'tail-colors.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await expect(p.getByLabel('Action 1 tail light 1 color',{exact:true})).toHaveValue('#ff0000');
 await expect(p.getByLabel('Action 1 tail light 3 color',{exact:true})).toHaveValue('#0000ff');
 console.log('100% desktop LED rows, independent colors, export, accordion order, banner removal and Play/STOP passed.');
}finally{await b.close();}
