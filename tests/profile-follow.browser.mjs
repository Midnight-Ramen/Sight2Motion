import {chromium,expect} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {openSetup} from './setup-ui.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});

const page=await context.newPage();
await page.addInitScript(()=>{
 window.profileMotion={paths:[],distance:40};
 const originalFetch=window.fetch;
 window.fetch=async(url,options)=>{
  if(!String(url).startsWith('http://127.0.0.1:30061/'))return originalFetch(url,options);
  const path=new URL(String(url)).pathname;window.profileMotion.paths.push(path);
  return new Response(path.includes('/Distance/')?String(window.profileMotion.distance):path.includes('/Encoder/')?'0':path.includes('/Line/')?'98':path.includes('/in/')?'true':'200');
 };
 const NativeWorker=window.Worker;
 window.Worker=class {
  constructor(url,options){if(!String(url).includes('MobileSAM.worker'))return new NativeWorker(url,options);this.width=320;this.height=240;this.closed=false;}
  postMessage(message){
   let result=true;
   if(message.kind==='encode'){this.width=message.bitmap.width;this.height=message.bitmap.height;}
   if(message.kind==='decode'){
    const mask=new Uint8Array(this.width*this.height);for(let y=70;y<130;y++)for(let x=90;x<150;x++)mask[y*this.width+x]=1;
    result={mask,width:this.width,height:this.height,boundingBox:{x:90,y:70,width:60,height:60},centroid:{x:120,y:100},area:3600};
   }
   setTimeout(()=>{if(!this.closed)this.onmessage?.({data:{result}});},10);
  }
  terminate(){this.closed=true;}
 };
 let canvas,side=false,hidden=false,frames=0;
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
  const paint=()=>{frames++;ctx.fillStyle='rgb(30,30,30)';ctx.fillRect(0,0,320,240);
   if(!hidden)for(let y=70;y<130;y++)for(let x=90;x<150;x++){ctx.fillStyle=`rgb(${(side?180:80)+(x%5)*10},${(side?50:150)+(y%4)*15},${side?190:40})`;ctx.fillRect(x,y,1,1);}
   ctx.fillStyle=`rgb(${frames%255},80,120)`;ctx.fillRect(0,0,12,12);
  };paint();setInterval(paint,40);return canvas.captureStream(25);
 }});
 Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[{deviceId:'fixture',kind:'videoinput',label:'Synthetic profile camera',groupId:''}]});
 window.profileFixture={setSide:value=>{side=value;},setHidden:value=>{hidden=value;},getFrames:()=>frames};
});
try{
 await page.goto('http://127.0.0.1:5174/');
 await openSetup(page,'AI vision');await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('mobile-sam');
 await page.locator('.selection-drawer > summary').click();
 await expect(page.locator('.target-advanced')).not.toHaveAttribute('open','');
 await page.getByRole('button',{name:'Start Camera',exact:true}).click();
 await expect(page.locator('.camera-panel .status')).toContainText('Camera live');
 await page.getByRole('button',{name:'Select target',exact:true}).click();
 await page.getByRole('button',{name:'Capture frame',exact:true}).click();
 const selection=page.getByLabel('Frozen frame: click an object to segment');
 await expect(selection).toBeVisible();await expect(page.locator('.selection-controls')).toContainText('Click an object');
 await expect(page.getByRole('button',{name:'Follow selected target',exact:true})).toHaveCount(0);await expect(page.getByLabel('Selection mode')).not.toBeVisible();await expect(page.getByRole('button',{name:'Track target',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Select target',exact:true})).toHaveCount(0);
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/mobile-sam-selection-live-inset.png'});
 await page.waitForTimeout(200);
 const before=await page.evaluate(()=>({time:document.querySelector('video').currentTime,frames:window.profileFixture.getFrames(),snapshot:document.querySelector('.selection-frame').getContext('2d').getImageData(0,0,1,1).data[0],live:document.querySelector('.snapshot-live-inset canvas').getContext('2d').getImageData(0,0,1,1).data[0]}));
 await page.waitForTimeout(300);
 const after=await page.evaluate(()=>({time:document.querySelector('video').currentTime,frames:window.profileFixture.getFrames(),snapshot:document.querySelector('.selection-frame').getContext('2d').getImageData(0,0,1,1).data[0],live:document.querySelector('.snapshot-live-inset canvas').getContext('2d').getImageData(0,0,1,1).data[0]}));
 expect(after.frames).toBeGreaterThan(before.frames);expect(after.time).toBeGreaterThan(before.time);expect(after.snapshot).toBe(before.snapshot);expect(after.live).not.toBe(before.live);
 await page.getByRole('button',{name:'Retake',exact:true}).click();await expect(selection).toHaveCount(0);await expect(page.locator('.snapshot-live-inset')).toHaveCount(0);
 async function selectView(){
  if(!await page.getByRole('button',{name:'Capture frame',exact:true}).count())await page.getByRole('button',{name:'Select target',exact:true}).click();
  await page.getByRole('button',{name:'Capture frame',exact:true}).click();await expect(selection).toBeVisible();await expect(page.getByRole('button',{name:'Clear',exact:true})).toBeEnabled();
  const rect=await selection.boundingBox(),scale=Math.min(rect.width/320,rect.height/240);
  await selection.click({position:{x:(rect.width-320*scale)/2+120*scale,y:(rect.height-240*scale)/2+100*scale}});
  await expect(page.getByLabel('Target label')).toBeVisible();
 }
 await selectView();await page.getByLabel('Target label').fill('Red robot');await page.getByRole('button',{name:'Save view',exact:true}).click();
 await expect(page.getByTestId('reference-view')).toHaveCount(1);await expect(selection).toHaveCount(0);
 await expect(page.getByLabel('Target label')).toHaveValue('Red robot');
 await page.getByRole('button',{name:'Capture another view',exact:true}).click();await expect(selection).toHaveCount(0);
 await page.evaluate(()=>window.profileFixture.setSide(true));await page.waitForTimeout(150);
 await selectView();await expect(page.getByLabel('Target label')).toHaveValue('Red robot');await expect(page.getByLabel('Target label')).toBeDisabled();
 await page.getByRole('button',{name:'Save view',exact:true}).click();await expect(page.getByTestId('reference-view')).toHaveCount(2);await expect(selection).toHaveCount(0);
 const downloadPromise=page.waitForEvent('download');await page.getByLabel('Import and export',{exact:true}).click();await page.getByRole('button',{name:'Export JSON',exact:true}).click();
 const download=await downloadPromise;const project=JSON.parse(readFileSync(await download.path(),'utf8'));
 expect(project.targetProfiles[0].label).toBe('Red robot');expect(project.targetProfiles[0].references).toHaveLength(2);
 expect(project.targetProfiles[0].references[0].crop.image).toMatch(/^data:image\/png;base64,/);
 const imported=await page.evaluate(async project=>{const {parseProject}=await import('/src/core/ProjectStorage.ts');return parseProject(JSON.stringify(project));},project);
 expect(imported.targetProfiles).toEqual(project.targetProfiles);
 await page.getByLabel('Import and export',{exact:true}).click();
 const mode=page.getByLabel('Base driving behavior',{exact:true});
 await expect(mode.locator('option',{hasText:'Follow selected target'})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Follow selected target',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Stop following',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Delete rule 1',exact:true}).click();
 await openSetup(page,'Your robot');await page.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await mode.selectOption('Follow selected target');
 const moving=()=>page.evaluate(()=>window.profileMotion.paths.filter(path=>/\/wheels\/A\/(?!0\/0\/)/.test(path)).length);
 await page.waitForTimeout(400);expect(await moving()).toBe(0);
 const play=page.getByRole('button',{name:'Play rules',exact:true}),stop=page.getByRole('button',{name:/STOP ROBOT/});
 await expect(play).toBeEnabled();await play.click();
 await expect(page.locator('#play-controls').getByRole('button',{name:'Running',exact:true})).toBeVisible();
 await expect.poll(moving,{timeout:10000}).toBeGreaterThan(0);
 await expect(page.locator('.target-live-status')).toContainText('Red robot');await expect(page.locator('.target-live-status')).toContainText('Tracking');
 await page.evaluate(()=>window.profileFixture.setSide(false));await page.waitForTimeout(500);
 await expect(page.locator('#play-controls').getByRole('button',{name:'Running',exact:true})).toBeVisible();await expect(page.locator('.target-live-status')).toContainText('Tracking');
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/profile-follow-global-play.png'});
 await stop.click();const afterStop=await moving();await page.waitForTimeout(800);expect(await moving()).toBe(afterStop);
 await expect(play).toBeEnabled();await play.click();await expect.poll(moving).toBeGreaterThan(afterStop);
 await page.evaluate(()=>window.profileFixture.setHidden(true));
 await expect(play).toBeVisible({timeout:5000});await expect(page.locator('.target-live-status')).toContainText('Lost');
 const afterLoss=await moving();await page.evaluate(()=>window.profileFixture.setHidden(false));await page.waitForTimeout(1000);expect(await moving()).toBe(afterLoss);
 await expect(play).toBeEnabled();await play.click();await expect.poll(moving).toBeGreaterThan(afterLoss);
 await page.keyboard.press('Space');const afterSpace=await moving();await page.waitForTimeout(700);expect(await moving()).toBe(afterSpace);
 await expect(page.getByRole('button',{name:'Follow selected target',exact:true})).toHaveCount(0);
 console.log('Profile base availability, paused configuration, Play auto-matching/Follow, alternate-view rotation, global STOP, target-loss/no automatic reacquisition and Space passed with simulated camera/SAM/BlueBird. No physical commands sent.');
}finally{await browser.close();}
