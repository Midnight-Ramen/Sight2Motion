import { expect, it } from 'vitest';
import { TargetTracker, TRACKING_DEFAULTS } from '../src/core/TargetTracker';
import { orientDetections } from '../src/core/CameraOrientation';
import type { Detection } from '../src/core/types';
import type { SelectedSegment } from '../src/core/SegmentationGeometry';
const person=(x:number,confidence=0.9):Detection=>({className:'person',confidence,x,y:100,width:100,height:200,centerX:x+50,centerY:200});
const segment=(x=100):SelectedSegment=>({width:640,height:480,mask:new Uint8Array(0),boundingBox:{x,y:100,width:100,height:200},centroid:{x:x+50,y:200},area:20000});
it('locks highest overlap rather than highest confidence, then favors the same nearby person',()=>{
 const t=new TargetTracker(); t.initialize(segment(),[person(100,0.75),person(400,0.99)],false,0);
 const result=t.update([person(110,0.72),person(300,0.99)],100)!;
 expect(result.boundingBox.x).toBe(103); expect(result.label).toBe('person'); expect(result.lostFrames).toBe(0);
});
it('rejects large jumps even to a very confident same-class person',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100)],false,0);
 const result=t.update([person(500,0.99)],100)!;
 expect(result.centerX).toBe(150); expect(result.state).toBe('TEMPORARILY_LOST');
});
it('treats indistinguishable crossing candidates as uncertain rather than switching',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100)],false,0);
 t.update([person(110)],100);
 const result=t.update([person(114),person(116)],200)!;
 expect(result.state).toBe('TEMPORARILY_LOST');expect(result.boundingBox.x).toBe(103);
});
it('tolerates gaps, reacquires nearby, loses stale input by elapsed time, never globally reacquires',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100)],false,0);
 expect(t.update([],100)!.targetLost).toBe(false);
 expect(t.update([person(105)],200)!.state).toBe('TRACKING');
 expect(t.age(1000)!.targetLost).toBe(true);
 expect(t.update([person(500)],1100)!.targetLost).toBe(true);
 expect(t.update([person(105)],1200)!.state).toBe('TRACKING');
});
it('smoothing and normalized measurements use the displayed orientation once',()=>{
 const raw=person(100); const displayed=orientDetections([raw],640,true);
 const t=new TargetTracker(); const target=t.initialize(segment(),displayed,true,0)!;
 expect(target.centerX).toBe(490);expect(target.horizontalError).toBeCloseTo(0.53125);
 expect(target.normalizedArea).toBeCloseTo(20000/(640*480));
 const next=t.update(orientDetections([person(120)],640,true),100)!;
 expect(next.centerX).toBe(484);expect(next.boundingBox.width).toBe(100);
});
it.each([[20,-1],[270,0],[500,1]])('horizontal error has expected sign at x=%s',(x,sign)=>{
 const t=new TargetTracker();const target=t.initialize(segment(x),[person(x)],false,0)!;
 expect(Math.sign(target.horizontalError)).toBe(sign);
});
it('unknown SAM objects retain their mask and cannot track unrelated detections',()=>{
 const t=new TargetTracker();const s=segment();expect(t.initialize(s,[person(450)],false,0)).toBeNull();
 expect(t.state).toBe('SAM_SELECTED');expect(t.selected!.mask).toBe(s.mask);
 t.stop();expect(t.selected).toBeNull();expect(t.getTrackedTarget()).toBeNull();expect(t.state).toBe('IDLE');
});
it('learns slow detector cadence within a bounded timeout',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100)],false,0);
 for(let i=1;i<=5;i++)t.update([person(100)],i*1000);
 expect(t.lossTimeoutMs).toBeGreaterThan(1000);expect(t.lossTimeoutMs).toBeLessThanOrEqual(TRACKING_DEFAULTS.maxLossMs);
 expect(t.age(6000)!.targetLost).toBe(false);expect(t.age(8000)!.targetLost).toBe(true);
});
it('history replay follows movement while the frozen SAM image is processed',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100)],false,0);
 for(let i=1;i<=20;i++)t.update([person(100+i*10),person(500,0.99)],i*250);
 expect(t.getTrackedTarget()!.boundingBox.x).toBeGreaterThan(260);
 expect(t.getTrackedTarget()!.boundingBox.x).toBeLessThan(310);
});
it('maintains motion continuity when two people cross and separate',()=>{
 const t=new TargetTracker();t.initialize(segment(),[person(100),person(500,0.99)],false,0);
 for(let i=1;i<=18;i++)t.update([person(100+20*i,0.8),person(500-20*i,0.99)],i*200);
 expect(t.getTrackedTarget()!.centerX).toBeGreaterThan(440);
 expect(t.getTrackedTarget()!.targetLost).toBe(false);
});
