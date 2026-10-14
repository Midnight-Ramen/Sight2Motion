import {chromium,expect} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {openSetup} from './setup-ui.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});

const page=await context.newPage();
await page.addInitScript(()=>{
 window.profileLabels=[];
 const nativeFillText=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.classList.contains('tracking-overlay'))window.profileLabels.push(text);return nativeFillText.call(this,text,...args);};
 window.profileMotion={paths:[],distance:40};
 window.profileSAM={encodes:0,decodes:0};
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
   if(message.kind==='encode'){window.profileSAM.encodes++;this.width=message.bitmap.width;this.height=message.bitmap.height;}
   if(message.kind==='decode'){
    window.profileSAM.decodes++;
    const sx=this.width/320,sy=this.height/240;
    const mask=new Uint8Array(this.width*this.height);for(let y=Math.round(70*sy);y<Math.round(130*sy);y++)for(let x=Math.round(90*sx);x<Math.round(150*sx);x++)mask[y*this.width+x]=1;
    result={mask,width:this.width,height:this.height,boundingBox:{x:90*sx,y:70*sy,width:60*sx,height:60*sy},centroid:{x:120*sx,y:100*sy},area:3600*sx*sy};
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
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
 const download=await downloadPromise;const project=JSON.parse(readFileSync(await download.path(),'utf8'));
 expect(project.targetProfiles[0].label).toBe('Red robot');expect(project.targetProfiles[0].references).toHaveLength(2);
 expect(project.targetProfiles[0].references[0].crop.image).toMatch(/^data:image\/png;base64,/);
 const imported=await page.evaluate(async project=>{const {parseProject}=await import('/src/core/ProjectStorage.ts');return parseProject(JSON.stringify(project));},project);
 expect(imported.targetProfiles).toEqual(project.targetProfiles);
 // Starting with no visible target must keep the profile session searching live frames.
 await page.evaluate(()=>window.profileFixture.setHidden(true));await page.waitForTimeout(150);
 await page.getByRole('button',{name:'Track target',exact:true}).click();
 await page.locator('.target-advanced > summary').click();
 const diagnostics=page.getByLabel('Target matching diagnostics');
 await expect(diagnostics).toContainText('State: MATCHING');
 await expect(diagnostics).toContainText('Search: global');
 await expect(diagnostics).toContainText('Tracking active: yes');
 await expect(diagnostics).toContainText(/Raw candidates: [1-9][0-9]*/);
 const firstSequence=Number((await diagnostics.textContent()).match(/Matcher frame sequence: (\d+)/)[1]);
 await expect.poll(async()=>Number((await diagnostics.textContent()).match(/Matcher frame sequence: (\d+)/)[1])).toBeGreaterThan(firstSequence);
 await page.evaluate(()=>window.profileFixture.setHidden(false));
 await expect(diagnostics).toContainText('State: TRACKING');
 const outline=page.getByLabel('Tracked target outline and center');await expect(outline).toBeVisible();
 await expect.poll(()=>outline.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+1]>180&&d[i]<100&&d[i+3]>0)n++;return n;})).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(()=>window.profileLabels.some(text=>/^Red robot · [0-9]+%$/.test(text)))).toBe(true);
 await page.evaluate(()=>window.profileFixture.setHidden(true));
 await expect(diagnostics).toContainText('State: REACQUIRING');
 await expect(diagnostics).toContainText('State: LOST',{timeout:15000});
 expect(await outline.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;})).toBe(0);
 await page.evaluate(()=>window.profileFixture.setHidden(false));
 await page.getByRole('button',{name:'Stop tracking',exact:true}).click();
 await page.locator('.target-advanced > summary').click();
 console.log('Track target lifecycle passed: initial global search, nonzero work, fresh-frame progression, and later acquisition.');
 const mode=page.getByLabel('Base driving behavior',{exact:true});
 await expect(mode.locator('option',{hasText:'Follow selected target'})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Follow selected target',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Stop following',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Delete rule 1',exact:true}).click();
 await openSetup(page,'Your robot');await page.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await mode.selectOption('Follow selected target');
 // Isolate target tracking from the separately tested distance-sensor safety assist.
 await page.getByRole('checkbox',{name:'Emergency braking',exact:true}).uncheck();
 const moving=()=>page.evaluate(()=>window.profileMotion.paths.filter(path=>/\/wheels\/A\/(?!0\/0\/)/.test(path)).length);
 await page.waitForTimeout(400);expect(await moving()).toBe(0);
 const play=page.getByRole('button',{name:'Play rules',exact:true}),stop=page.getByRole('button',{name:/STOP ROBOT/});
 await expect(page.locator("#play-controls")).toContainText("Ready to run");await expect(play).toBeEnabled();await play.click();
 await expect(page.locator('#play-controls').getByRole('button',{name:'Running',exact:true})).toBeVisible();
 await expect.poll(moving,{timeout:10000}).toBeGreaterThan(0);
 await expect(page.locator('.target-live-status')).toContainText('Red robot');await expect(page.locator('.target-live-status')).toContainText('Tracking');
 await page.evaluate(()=>window.profileFixture.setSide(false));await page.waitForTimeout(500);
 await expect(page.locator('#play-controls').getByRole('button',{name:'Running',exact:true})).toBeVisible();await expect(page.locator('.target-live-status')).toContainText('Tracking');
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/profile-follow-global-play.png'});
 await stop.click();const afterStop=await moving();await page.waitForTimeout(800);expect(await moving()).toBe(afterStop);
 await expect(play).toBeEnabled();await play.click();await expect.poll(moving).toBeGreaterThan(afterStop);
 await page.evaluate(()=>window.profileFixture.setHidden(true));
 await expect(page.locator('.target-live-status')).toContainText('Reacquiring');
 const held=await moving();await page.waitForTimeout(500);expect(await moving()).toBe(held);
 const beforeVerification=await page.evaluate(()=>({...window.profileSAM}));
 await page.evaluate(()=>window.profileFixture.setHidden(false));
 await expect(page.locator('.target-live-status')).toContainText('Reacquired');
 const afterVerification=await page.evaluate(()=>({...window.profileSAM}));
 expect(afterVerification.encodes-beforeVerification.encodes).toBeGreaterThanOrEqual(3);
 expect(afterVerification.decodes-beforeVerification.decodes).toBeGreaterThanOrEqual(3);
 await expect.poll(moving).toBeGreaterThan(held);
 await page.evaluate(()=>window.profileFixture.setHidden(true));
 await expect(play).toBeVisible({timeout:7000});
 await expect(page.locator('.base-strip-status')).toContainText('Target lost');
 const afterLoss=await moving();await page.evaluate(()=>window.profileFixture.setHidden(false));await page.waitForTimeout(1000);expect(await moving()).toBe(afterLoss);
 await expect(play).toBeEnabled();await play.click();await expect.poll(moving).toBeGreaterThan(afterLoss);
 await page.keyboard.press('Space');const afterSpace=await moving();await page.waitForTimeout(700);expect(await moving()).toBe(afterSpace);
 await expect(page.getByRole('button',{name:'Follow selected target',exact:true})).toHaveCount(0);
 console.log('Profile base availability, paused configuration, Play auto-matching/Follow, alternate-view rotation, global STOP, bounded reacquisition/resume and terminal timeout and Space passed with simulated camera/SAM/BlueBird. No physical commands sent.');
}finally{await browser.close();}
