import { expect, it } from 'vitest';
import { promptInputs } from '../src/core/SAMPrompts';
import { associateSelection } from '../src/core/SAMAssociation';
import { summarizeMask } from '../src/core/SegmentationGeometry';
import { TargetTracker } from '../src/core/TargetTracker';
import { orientDetections } from '../src/core/CameraOrientation';
import type { Detection } from '../src/core/types';
const cup:Detection={className:'cup',confidence:0.8,x:30,y:20,width:40,height:60,centerX:50,centerY:50};
function selection() {
  const mask=new Uint8Array(100*100);
  for(let y=40;y<65;y++)for(let x=40;x<60;x++)mask[y*100+x]=1;
  return {...summarizeMask(mask,100,100),displayName:"Jonathan's Cup"};
}
it('passes all positive and negative labels and one padding point at decoder scale',()=>{
  const result=promptInputs({points:[{x:10,y:20,label:1},{x:30,y:40,label:1},{x:15,y:25,label:0}]},2,3);
  expect([...result.labels]).toEqual([1,1,0,-1]);expect([...result.coords]).toEqual([20,60,60,120,30,75,0,0]);
});
it('uses SAM box corner labels without padding and preserves accompanying points',()=>{
  const result=promptInputs({points:[{x:5,y:6,label:0}],box:{x:10,y:20,width:30,height:40}},2,2);
  expect([...result.labels]).toEqual([0,2,3]);expect([...result.coords]).toEqual([10,12,20,40,80,120]);
});
it('requires a positive anchor before decoding negative-only prompts',()=>{
  expect(()=>promptInputs({points:[{x:1,y:2,label:0}]},1,1)).toThrow();
});
it('associates a partially visible cup below 0.35 IoU using centroid and mask coverage',()=>{
  const match=associateSelection(selection(),[cup],false)!;
  expect(match.iou).toBeLessThan(0.35);expect(match.coverage).toBe(1);expect(match.centroidInside).toBe(true);
  expect(match.detection.className).toBe('cup');
});
it('rejects a surrounding person and prefers the cup, without requiring the name to match',()=>{
  const person={...cup,className:'person',confidence:0.99,x:0,y:0,width:100,height:100};
  expect(associateSelection(selection(),[person],false)).toBeNull();
  expect(associateSelection(selection(),[person,cup],false)!.detection.className).toBe('cup');
});
it('retains names independently of the detector class during live updates',()=>{
  const tracker=new TargetTracker();
  const result=tracker.initialize(selection(),[cup],false,1)!;
  expect(result).toMatchObject({displayName:"Jonathan's Cup",label:'cup',detectorLabel:'cup',detectorClassId:41});
  expect(tracker.update([{...cup,x:31}],100)!.displayName).toBe("Jonathan's Cup");
  expect(tracker.initialize({...selection(),displayName:' '},[cup],false,200)!.displayName).toBe('Selected object');
});
it('uses mirrored mask coverage and centroid consistently',()=>{
  const match=associateSelection(selection(),orientDetections([cup],100,true),true)!;
  expect(match.coverage).toBe(1);expect(match.centroidInside).toBe(true);
});
it('allows unknown object names with no detection and declines ambiguous candidates',()=>{
  const s={...selection(),displayName:'Gearbox Prototype',detectorLabel:null};
  expect(associateSelection(s,[],false)).toBeNull();expect(s.displayName).toBe('Gearbox Prototype');
  expect(associateSelection(s,[cup,{...cup,className:'bottle'}],false)).toBeNull();
});
