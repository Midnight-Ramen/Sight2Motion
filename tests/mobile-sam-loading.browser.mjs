import {chromium,expect} from '@playwright/test';
import {openSetup} from './setup-ui.mjs';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
const page=await context.newPage();
await page.addInitScript(()=>{
  window.samFixture={loads:0,workers:0,terminated:0,frames:0};
  const NativeWorker=window.Worker;
  window.Worker=class {
    constructor(url,options){if(!String(url).includes('MobileSAM.worker'))return new NativeWorker(url,options);window.samFixture.workers++;}
    postMessage(message){if(message.kind==='load')window.samFixture.loads++;setTimeout(()=>this.onmessage?.({data:{result:true}}),message.kind==='load'?4000:message.kind==='encode'?500:10);}
    terminate(){window.samFixture.terminated++;}
  };
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
    setInterval(()=>{window.samFixture.frames++;ctx.fillStyle=`rgb(${window.samFixture.frames%255},80,120)`;ctx.fillRect(0,0,320,240);},40);
    return canvas.captureStream(25);
  }});
  Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[{deviceId:'fixture',kind:'videoinput',label:'Synthetic camera',groupId:''}]});
});
try {
  await page.goto('http://127.0.0.1:5174/');await page.getByRole('button',{name:'Start Camera',exact:true}).click();
  await expect(page.locator('.camera-panel .status')).toContainText('Camera live');
  await expect(page.getByRole('button',{name:'Select target',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.samFixture.loads)).toBe(0);
  await openSetup(page,'AI vision');await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('mobile-sam');
  await expect(page.locator('#model-panel')).toContainText('Loading MobileSAM');
  const initial=await page.evaluate(()=>({frames:window.samFixture.frames,time:document.querySelector('video').currentTime}));
  await page.getByRole('button',{name:'Select target',exact:true}).click();await expect(page.getByRole('button',{name:'Capture frame',exact:true})).toBeDisabled();
  await expect(page.locator('.target-advanced')).not.toHaveAttribute('open','');
  await expect(page.getByLabel('Selection mode')).not.toBeVisible();await expect(page.getByRole('button',{name:'Undo point',exact:true})).toHaveCount(0);
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();await expect(page.getByRole('switch',{name:'Dark mode',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('button',{name:'Expand camera',exact:true}).click();await expect(page.getByRole('button',{name:'Collapse camera',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'STOP ROBOT',exact:false}).click();await expect(page.getByText('STOP requested.',{exact:false})).toBeVisible();
  await page.locator('.vision-column').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await openSetup(page,'Your robot');await openSetup(page,'AI vision');
  const during=await page.evaluate(()=>({frames:window.samFixture.frames,time:document.querySelector('video').currentTime,loads:window.samFixture.loads}));
  expect(during.frames).toBeGreaterThan(initial.frames);expect(during.time).toBeGreaterThan(initial.time);expect(during.loads).toBe(1);
  await expect(page.locator('#model-panel')).toContainText('MobileSAM ready',{timeout:15000});
  await page.getByRole('button',{name:'Capture frame',exact:true}).click();await expect(page.getByLabel('Frozen frame: click an object to segment')).toBeVisible();
  await page.getByRole('button',{name:'Retake',exact:true}).click();await expect(page.getByLabel('Frozen frame: click an object to segment')).toHaveCount(0);
  await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('yolo');await expect(page.getByRole('button',{name:'Select target',exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('mobile-sam');await expect(page.locator('#model-panel')).toContainText('MobileSAM ready');
  expect(await page.evaluate(()=>window.samFixture)).toMatchObject({loads:1,workers:1,terminated:0});
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/mobile-sam-compact-live.png'});
  console.log('Delayed-load UI responsiveness, camera continuity, STOP, navigation, lazy loading, retained worker, overlay gating and collapsed advanced settings passed.');
} finally {await browser.close();}
