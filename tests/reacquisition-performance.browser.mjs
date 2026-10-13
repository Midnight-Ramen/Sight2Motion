import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 const views=Number(process.argv[2]??5);
 const result=await page.evaluate(async(viewCount)=>{
 const {AppearanceTracker}=await import('/src/core/AppearanceTracker.ts');
 const {summarizeMask}=await import('/src/core/SegmentationGeometry.ts');
 const width=160,height=120;
 function frame(x=30,y=30,view=0){const data=new Uint8ClampedArray(width*height*4).fill(30);for(let dy=0;dy<30;dy++)for(let dx=0;dx<24;dx++){const i=((y+dy)*width+x+dx)*4;data[i]=60+view*20+dx%5*10;data[i+1]=150+dy%4*15;data[i+2]=40+view*20;}return {data,width,height};}
 const mask=new Uint8Array(width*height);for(let y=30;y<60;y++)for(let x=30;x<54;x++)mask[y*width+x]=1;
 const profile={label:'Cup',matchThreshold:.7,references:Array.from({length:viewCount},(_,view)=>({appearance:AppearanceTracker.reference(frame(30,30,view),summarizeMask(mask,width,height))}))};
 const local=[],global=[],intervals=[];
 for(let i=0;i<12;i++){
  const tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,width,height);tracker.update(frame(),0,width,height);
  let at=performance.now();tracker.update(frame(),100,width,height);local.push(performance.now()-at);
  tracker.update(frame(110,70,4),200,width,height);
  let last=performance.now();
  for(const t of [300,600,900]){await new Promise(r=>setTimeout(r,300));at=performance.now();intervals.push(at-last);tracker.update(frame(110,70,4),t,width,height);global.push(performance.now()-at);last=at;}
  if(tracker.age(900)?.state!=='TRACKING')throw new Error('Global reacquisition failed');
 }
 const timed=new AppearanceTracker();timed.initializeProfile(profile,false,width,height);timed.update(frame(),performance.now(),width,height);
 const searches=[];const search=timed.globalSearch.bind(timed);timed.globalSearch=(image)=>{searches.push(performance.now());return search(image);};
 const empty={data:new Uint8ClampedArray(width*height*4).fill(30),width,height};
 await new Promise(resolve=>{const started=performance.now();const timer=setInterval(()=>{timed.update(empty,performance.now(),width,height);if(performance.now()-started>=2000){clearInterval(timer);resolve();}},100);});
 const actualIntervals=searches.slice(1).map((time,i)=>time-searches[i]);
 const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)};};
 return {width,height,views:viewCount,local:stats(local),global:stats(global),syntheticReturnIntervals:stats(intervals),actual100msLoopGlobalIntervals:stats(actualIntervals),note:'Synthetic Chrome frames; elapsed main-thread matching time, not OS CPU utilization or camera inference throughput.'};
 },views);
 writeFileSync(`test-results/reacquisition-performance-${views}.json`,JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}
