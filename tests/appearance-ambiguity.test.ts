import {expect,it,vi} from 'vitest';
import {AppearanceTracker,clusterAppearanceCandidates,type AppearanceCandidate} from '../src/core/AppearanceTracker';
import {summarizeMask} from '../src/core/SegmentationGeometry';
import {saveTargetView} from '../src/core/TargetProfiles';
const candidate=(x:number,score:number,width=20,height=24):AppearanceCandidate=>({box:{x,y:25,width,height},score,view:5,scale:1});
it('overlapping variants form one hypothesis, keeping the highest score and view',()=>{
 const boxes=[candidate(30,.88),candidate(36,.875),candidate(42,.87),candidate(75,.72)];
 const result=clusterAppearanceCandidates(boxes);
 expect(result).toEqual([boxes[0],boxes[3]]);
 expect(boxes).toHaveLength(4);
});
it('separate objects remain distinct and overlap chains cannot span the frame',()=>{
 expect(clusterAppearanceCandidates([candidate(10,.88),candidate(60,.87)])).toHaveLength(2);
 const chain=Array.from({length:12},(_,i)=>candidate(i*6,.95-i*.001));
 expect(clusterAppearanceCandidates(chain).length).toBeGreaterThan(1);
});
function recovering(threshold=.7){
 const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(30),mask=new Uint8Array(width*height);
 for(let y=25;y<49;y++)for(let x=30;x<50;x++) {mask[y*width+x]=1;data[(y*width+x)*4+1]=180;}
 const frame={data,width,height};
 const profile=saveTargetView([],'Cup',{id:'cup',crop:{image:'x',mask:'x',width:1,height:1},appearance:AppearanceTracker.reference(frame,summarizeMask(mask,width,height))})[0];
 profile.matchThreshold=threshold;
 const tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,width,height);
 expect(tracker.update(frame,0,width,height)?.state).toBe('TRACKING');tracker.age(800);
 const search=vi.spyOn(tracker as unknown as {globalSearch:(image:typeof frame)=>AppearanceCandidate[]},'globalSearch');
 return {tracker,frame,search,update:(t:number)=>tracker.update(frame,t,width,height)};
}
it('88% match with nearby 87% variants reaches three stable searches without false ambiguity',()=>{
 const {tracker,search,update}=recovering();
 search.mockReturnValue([candidate(30,.88),candidate(36,.875),candidate(42,.87),candidate(75,.72)]);
 expect(update(900)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(1);
 expect(update(1200)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(2);
 expect(update(1500)?.state).toBe('TRACKING');expect(tracker.diagnostics.stableCount).toBe(3);
 expect(tracker.diagnostics.secondDistinct).toBe(.72);expect(tracker.diagnostics.margin).toBeCloseTo(.16);
 expect(tracker.diagnostics.rawCandidates).toBe(4);expect(tracker.diagnostics.clusters).toBe(2);
});
it('another equally plausible object resets progress',()=>{
 const {tracker,search,update}=recovering();search.mockReturnValue([candidate(30,.88)]);update(900);
 search.mockReturnValue([candidate(30,.88),candidate(75,.87)]);
 expect(update(1200)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(0);
});
it.each([.7,.9])('confidence floor and higher profile threshold remain enforced (%s)',threshold=>{
 const {tracker,search,update}=recovering(threshold);search.mockReturnValue([candidate(30,threshold===.7?.77:.88)]);
 expect(update(900)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(0);
 expect(update(5900)?.state).toBe('LOST');
});
it('location or height jumps restart stability instead of resuming',()=>{
 const {tracker,search,update}=recovering();search.mockReturnValue([candidate(30,.88)]);update(900);
 search.mockReturnValue([candidate(70,.88)]);update(1200);expect(tracker.diagnostics.stableCount).toBe(1);
 search.mockReturnValue([candidate(70,.88,20,40)]);expect(update(1500)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(1);
});
