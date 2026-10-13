import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
await page.route('http://127.0.0.1:30061/**',route=>route.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174/');
 const input=page.locator('input[type="file"][accept=".json,application/json"]');
 await expect(input).toHaveCount(1);
 await input.evaluate(el=>el.dataset.testImport='shared');
 await page.getByLabel('Project name',{exact:true}).fill('Unsaved classroom work');
 const project=await page.evaluate(async()=>{const {makeProject}=await import('/src/core/types.ts');return {...makeProject(),name:'Opened from disk'};});
 const pick=async(name,file)=>{
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByRole('button',{name,exact:true}).click();
  const chooser=await chooserPromise;
  expect(await chooser.element().getAttribute('data-test-import')).toBe('shared');
  await chooser.setFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(file)});
 };
 await pick('Open',JSON.stringify(project));
 await expect(page.getByLabel('Project name',{exact:true})).toHaveValue('Opened from disk');
 expect(await page.evaluate(()=>localStorage.getItem('vision-robot-studio.projects.v1'))).toContain('Unsaved classroom work');
 await expect(page.locator('.notice')).toContainText('AI is paused');
 await pick('Open','not json');
 await expect(page.locator('.notice')).toContainText('could not be imported');
 await expect(page.getByLabel('Project name',{exact:true})).toHaveValue('Opened from disk');
 await pick('Open',JSON.stringify({...project,name:'Imported again'}));
 await expect(page.getByLabel('Project name',{exact:true})).toHaveValue('Imported again');
 await pick('Open',JSON.stringify({name:'Invalid schema'}));
 await expect(page.locator('.notice')).toContainText('could not be imported');
 await expect(page.getByLabel('Project name',{exact:true})).toHaveValue('Imported again');
 await expect(input).toHaveCount(1);
 console.log('Open uses one native picker; valid import, invalid JSON/schema, and unsaved-work preservation passed.');
} finally {await browser.close();}
