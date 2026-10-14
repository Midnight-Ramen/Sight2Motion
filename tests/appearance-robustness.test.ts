import {expect,it} from 'vitest';
import {AppearanceTracker} from '../src/core/AppearanceTracker';
import {summarizeMask} from '../src/core/SegmentationGeometry';
import type {TargetProfile} from '../src/core/TargetProfiles';
const width=160,height=120;
function frame({x=40,y=40,scale=1,gain=1,background=25,view=0,missing=false}={}) {
 const data=new Uint8ClampedArray(width*height*4).fill(background);
 if(!missing)for(let dy=0;dy<30*scale;dy++)for(let dx=0;dx<24*scale;dx++){
  const u=Math.floor(dx/scale),v=Math.floor(dy/scale),i=((y+dy)*width+x+dx)*4;
  const shade=15*Math.sin((u+view*3)/7)+8*Math.cos(v/5);
  data[i]=(35+view*7+shade)*gain;data[i+1]=(150+shade)*gain;data[i+2]=(45+view*3+shade)*gain;
 }
 return {data,width,height};
}
function setup(){
 const mask=new Uint8Array(width*height);for(let y=40;y<70;y++)for(let x=40;x<64;x++)mask[y*width+x]=1;
 const selection=summarizeMask(mask,width,height);
 const profile:TargetProfile={label:'Green cup',matchThreshold:.7,references:Array.from({length:8},(_,view)=>({id:String(view),crop:{image:'',mask:'',width:1,height:1},appearance:AppearanceTracker.reference(frame({view}),selection)}))};
 const tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,width,height);return {tracker,profile};
}
it.each([.65,.8,1.2,1.4])('bounded local pyramid tracks target scale %s',scale=>{
 const {tracker}=setup();expect(tracker.update(frame(),0,width,height)?.state).toBe('TRACKING');
 const result=tracker.update(frame({scale}),100,width,height);
 expect(result?.state).toBe('TRACKING');expect(tracker.diagnostics.candidateScale).toBeCloseTo(scale);
});
it.each([.65,1.25])('normalized representation tolerates exposure gain %s and changed background',gain=>{
 const {tracker,profile}=setup(),saved=JSON.stringify(profile);
 tracker.update(frame(),0,width,height);
 expect(tracker.update(frame({gain,background:80}),100,width,height)?.state).toBe('TRACKING');
 expect(JSON.stringify(profile)).toBe(saved);
});
it('adaptive radius responds to object size, elapsed time, and recent movement',()=>{
 const {tracker}=setup();tracker.update(frame(),-100,width,height);tracker.update(frame(),0,width,height);const first=tracker.diagnostics.searchRadius;
 tracker.update(frame({x:55}),150,width,height);
 expect(tracker.update(frame({x:78}),350,width,height)?.state).toBe('TRACKING');
 expect(tracker.diagnostics.searchRadius).toBeGreaterThan(first);
});
it('eight views select a winning rotated view after a 1.5 second absence and far return',()=>{
 const {tracker}=setup();tracker.update(frame(),0,width,height);
 tracker.update(frame({missing:true}),100,width,height);
 expect(tracker.age(1500)?.state).toBe('REACQUIRING');
 for(const t of [1600,1900])expect(tracker.update(frame({x:112,y:70,view:7}),t,width,height)?.state).toBe('REACQUIRING');
 expect(tracker.update(frame({x:112,y:70,view:7}),2200,width,height)?.state).toBe('TRACKING');
 expect(tracker.diagnostics.winningView).toBe(8);
});
it('a featureless green field cannot pass as a bounded cup',()=>{
 const {tracker}=setup();tracker.update(frame(),0,width,height);
 const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=35;data[i+1]=150;data[i+2]=45;}
 for(let t=100;t<1500;t+=300)expect(tracker.update({data,width,height},t,width,height)?.state).toBe('REACQUIRING');
});
