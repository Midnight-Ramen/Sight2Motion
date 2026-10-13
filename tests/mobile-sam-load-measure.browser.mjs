import {chromium,expect} from '@playwright/test';
import {openSetup} from './setup-ui.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
const page=await context.newPage();
await page.addInitScript(()=>{
  window.samMeasurement={cameraFrames:0,loads:0,workers:0,raf:0,maxFrameGapMs:0,frameGaps:[],longTasks:[],workerLoadMs:0,backend:null};
  let previous=0;
  function tick(at){window.samMeasurement.raf++;if(previous){window.samMeasurement.maxFrameGapMs=Math.max(window.samMeasurement.maxFrameGapMs,at-previous);window.samMeasurement.frameGaps.push({start:previous,duration:at-previous});}previous=at;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  new PerformanceObserver(list=>{window.samMeasurement.longTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})));}).observe({entryTypes:['longtask']});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
    setInterval(()=>{window.samMeasurement.cameraFrames++;ctx.fillStyle=`rgb(${window.samMeasurement.cameraFrames%255},80,120)`;ctx.fillRect(0,0,320,240);},40);
    return canvas.captureStream(25);
  }});
  Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[{deviceId:'fixture',kind:'videoinput',label:'Synthetic camera',groupId:''}]});
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(url,options){super(url,options);this.sam=String(url).includes('MobileSAM.worker');if(this.sam){window.samMeasurement.workers++;this.addEventListener('message',e=>{if(this.loadAt && !e.data.error){window.samMeasurement.workerLoadMs=performance.now()-this.loadAt;window.samMeasurement.backend=e.data.result;this.loadAt=0;}});}}
    postMessage(message,...args){if(this.sam&&message.kind==='load'){window.samMeasurement.loads++;this.loadAt=performance.now();}return super.postMessage(message,...args);}
  };
});
try {
  await page.goto('http://127.0.0.1:5174/');await page.getByRole('button',{name:'Start Camera',exact:true}).click();await expect(page.locator('.camera-panel .status')).toContainText('Camera live');await openSetup(page,'AI vision');
  const cameraBefore=await page.evaluate(()=>({frames:window.samMeasurement.cameraFrames,time:document.querySelector('video').currentTime}));
  const firstStart=await page.evaluate(()=>performance.now());
  await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('mobile-sam');
  await expect(page.locator('#model-panel')).toContainText('Loading MobileSAM');
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();await expect(page.getByRole('switch',{name:'Dark mode',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('button',{name:'STOP ROBOT',exact:false}).click();await expect(page.getByText('STOP requested.',{exact:false})).toBeVisible();
  await openSetup(page,'Your robot');await openSetup(page,'AI vision');
  await expect(page.locator('#model-panel')).toContainText('MobileSAM ready',{timeout:180000});
  const firstReady=await page.evaluate(()=>performance.now());
  const cameraAfter=await page.evaluate(()=>({frames:window.samMeasurement.cameraFrames,time:document.querySelector('video').currentTime}));
  expect(cameraAfter.frames).toBeGreaterThan(cameraBefore.frames);expect(cameraAfter.time).toBeGreaterThan(cameraBefore.time);
  await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('yolo');
  const repeatStart=await page.evaluate(()=>performance.now());await page.getByRole('combobox',{name:'AI vision',exact:true}).selectOption('mobile-sam');
  await expect(page.locator('#model-panel')).toContainText('MobileSAM ready');const repeatReady=await page.evaluate(()=>performance.now());
  const measurements=await page.evaluate(()=>window.samMeasurement);
  expect(measurements.loads).toBe(1);expect(measurements.workers).toBe(1);expect(measurements.raf).toBeGreaterThan(20);
  const loadMaxFrameGapMs=Math.max(0,...measurements.frameGaps.filter(t=>t.start>=firstStart&&t.start<=firstReady).map(t=>t.duration));delete measurements.frameGaps;
  const result={loadMaxFrameGapMs,cameraFramesDuringLoad:cameraAfter.frames-cameraBefore.frames,cameraSecondsDuringLoad:cameraAfter.time-cameraBefore.time,environment:'Chrome headless, local Vite server, fresh isolated browser context, real MobileSAM/ONNX assets',firstReadyMs:firstReady-firstStart,repeatModeReadyMs:repeatReady-repeatStart,...measurements,loadIntervalLongTasks:measurements.longTasks.filter(t=>t.start>=firstStart&&t.start<=firstReady)};
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/mobile-sam-load-measurements.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
