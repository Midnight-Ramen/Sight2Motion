import {finchHypotheses} from './finch-hypotheses-fixture';
import {afterEach,expect,it,vi} from 'vitest';
import {AppearanceTracker,type AppearanceCandidate} from '../src/core/AppearanceTracker';
import {maskedDescriptor,compareMaskedDescriptors,verifiedAppearanceScore,createSAMVerifier,type CandidateVerifier} from '../src/core/SAMCandidateVerification';
import {summarizeMask} from '../src/core/SegmentationGeometry';
import {saveTargetView,type TargetReference} from '../src/core/TargetProfiles';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(background=30,gain=1){const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(background),mask=new Uint8Array(width*height);for(let y=25;y<49;y++)for(let x=30;x<50;x++){const i=(y*width+x)*4;mask[y*width+x]=1;data[i]=40*gain;data[i+1]=180*gain;data[i+2]=60*gain;}const image={data,width,height},segment=summarizeMask(mask,width,height);return {image,segment};}
const c=(x=30,score=.89,view=1,w=20,h=24):AppearanceCandidate=>({box:{x,y:25,width:w,height:h},score,view,scale:1});
const ref=(image:ReturnType<typeof fixture>['image'],segment:ReturnType<typeof fixture>['segment']):TargetReference=>({id:'cup',crop:{image:'unused',mask:'unused',width:20,height:24},appearance:AppearanceTracker.reference(image,segment)});
it('masked descriptors exclude background and normalize exposure',()=>{
 const a=fixture(),b=fixture(220,.7);const da=maskedDescriptor(a.image,a.segment),db=maskedDescriptor(b.image,b.segment);
 expect(compareMaskedDescriptors(da,db).descriptor).toBeCloseTo(1);expect(compareMaskedDescriptors(da,db).shape).toBe(1);
 expect(verifiedAppearanceScore(.89,compareMaskedDescriptors(da,db))).toBeCloseTo(.978);
});
it('color and shape mismatches score lower without modifying references',()=>{
 const {image,segment}=fixture(),a=maskedDescriptor(image,segment),snapshot=JSON.stringify(a);
 const b={...a,histogram:a.histogram.map((_,i)=>i===15?1:0),spatial:a.spatial.map(s=>s.length?[.8,.1,.1]:[]),aspect:4,fill:.2,occupancy:a.occupancy.map(n=>1-n)};
 const match=compareMaskedDescriptors(a,b);expect(match.descriptor).toBeLessThan(.5);expect(match.shape).toBeLessThan(.5);expect(JSON.stringify(a)).toBe(snapshot);
});
function setup(verifier:CandidateVerifier){
 const f=fixture();let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const tracker=new AppearanceTracker();tracker.initializeProfile(saveTargetView([],'Cup',ref(f.image,f.segment))[0],false,100,80,verifier);
 expect(tracker.update(f.image,0,100,80)?.state).toBe('TRACKING');now=800;tracker.age(now);
 vi.spyOn(tracker as unknown as {globalSearch:()=>AppearanceCandidate[]},'globalSearch').mockReturnValue([c(),c(65,.88),c(5,.87),c(80,.8),c(20,.75),c(55,.7)]);
 return {tracker,setTime:(t:number)=>{now=t;},update:(t:number)=>{now=t;return tracker.update(f.image,t,100,80);}};
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
it('shortlists five; only three verified stable masks resume, despite winning-view/box changes',async()=>{
 let n=0;const verify=vi.fn<CandidateVerifier>().mockImplementation(async(_,list)=>{expect(list.length).toBeLessThanOrEqual(5);n++;return {candidates:[c(30+n,.92,n,20+n,24+n),c(65,.7)],samMs:20,verifiedCount:2};});
 const {tracker,update}=setup(verify);
 for(const [i,t] of [900,1200,1500].entries()){expect(update(t)?.state).toBe('REACQUIRING');await flush();expect(tracker.diagnostics.stableCount).toBe(i+1);}
 expect(tracker.age(1500)?.state).toBe('TRACKING');expect(tracker.diagnostics.winningView).toBe(3);expect(tracker.diagnostics.verifiedCandidates).toBe(2);expect(verify).toHaveBeenCalledTimes(3);
});
it('multiple prompts resolving to the same mask do not create false ambiguity',async()=>{
 const {tracker,update}=setup(async()=>({candidates:[c(30,.92),c(30,.91)],samMs:20,verifiedCount:2}));update(900);await flush();expect(tracker.diagnostics.stableCount).toBe(1);expect(tracker.diagnostics.clusters).toBe(1);
});
it.each(['weak','ambiguous','empty','error'])('%s SAM verification never resumes',async kind=>{
 const {tracker,update}=setup(async()=>{if(kind==='error')throw new Error('SAM failed');return {candidates:kind==='empty'?[]:kind==='weak'?[c(30,.77)]:[c(30,.89),c(70,.88)],samMs:20,verifiedCount:2};});
 update(900);await flush();expect(tracker.age(900)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.stableCount).toBe(0);
});
it('one verification at a time; STOP discards pending masks',async()=>{
 let finish!:(v:Awaited<ReturnType<CandidateVerifier>>)=>void;let signal!:AbortSignal;
 const verify=vi.fn<CandidateVerifier>().mockImplementation((_,__,s)=>{signal=s;return new Promise(r=>finish=r);});const {tracker,update}=setup(verify);
 update(900);update(1200);expect(verify).toHaveBeenCalledTimes(1);tracker.stop();expect(signal.aborted).toBe(true);finish({candidates:[c()],samMs:20,verifiedCount:1});await flush();expect(tracker.age(1300)).toBeNull();
});
it.each([1800,6100])('late verification at %s cannot refresh stale frames; expiry waits for completion',async completed=>{
 let finish!:(v:Awaited<ReturnType<CandidateVerifier>>)=>void;
 const {tracker,update,setTime}=setup(()=>new Promise(r=>finish=r));update(900);setTime(completed);finish({candidates:[c(30,.99)],samMs:900,verifiedCount:1});await flush();
 expect(tracker.diagnostics.stableCount).toBe(1);expect(tracker.capturedAt).toBe(0);expect(tracker.age(completed)?.state).toBe(completed>=5000?'LOST':'REACQUIRING');
});
it('same worker encodes once and serially prompts at most two centers against all reference views',async()=>{
 const f=fixture(),good=maskedDescriptor(f.image,f.segment),bad={...good,histogram:good.histogram.map((_,i)=>i===15?1:0),spatial:good.spatial.map(s=>s.length?[.9,.05,.05]:[])};
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({putImageData:()=>{}})})});vi.stubGlobal('ImageData',class {constructor(..._:unknown[]) {}});
 let concurrent=0,max=0;const sam={ready:true,capture:vi.fn(async()=>{}),select:vi.fn(async()=>{concurrent++;max=Math.max(max,concurrent);await Promise.resolve();concurrent--;return f.segment;})};
 const references=[ref(f.image,f.segment),{...ref(f.image,f.segment),id:'other'}];const snapshot=JSON.stringify(references);
 const verify=createSAMVerifier(()=>sam,references,async r=>r.id==='other'?good:bad);
 const result=await verify(f.image,Array.from({length:7},()=>c()),new AbortController().signal);
 expect(sam.capture).toHaveBeenCalledTimes(1);expect(sam.select).toHaveBeenCalledTimes(1);expect(sam.select).toHaveBeenCalledWith(40,37);expect(max).toBe(1);expect(result.candidates.every(c=>c.view===2)).toBe(true);expect(result.verifiedCount).toBe(1);expect(result.ambiguityClear).toBe(true);expect(JSON.stringify(references)).toBe(snapshot);
});

it('three delayed verified identities never resume with stale geometry; a fresh result can resume',async()=>{
 let finish!:(v:Awaited<ReturnType<CandidateVerifier>>)=>void;
 const {tracker,update,setTime}=setup(()=>new Promise(r=>finish=r));
 for(const t of [900,1900,2900]) {update(t);setTime(t+800);finish({candidates:[c(30,.91,5)],samMs:800,verifiedCount:1});await flush();}
 expect(tracker.diagnostics.stableCount).toBe(3);expect(tracker.age(3700)?.state).toBe('REACQUIRING');expect(tracker.capturedAt).toBe(0);
 update(3900);setTime(4000);finish({candidates:[c(31,.91,2)],samMs:100,verifiedCount:1});await flush();expect(tracker.age(4000)?.state).toBe('TRACKING');
});
it('unresolved unverified competitors hold stability without permitting movement',async()=>{
 const {tracker,update}=setup(async()=>({candidates:[c(30,.91)],samMs:20,verifiedCount:1,ambiguityClear:false}));update(900);await flush();expect(tracker.diagnostics.stableCount).toBe(0);expect(tracker.age(900)?.state).toBe('REACQUIRING');expect(tracker.diagnostics.resetReason).toContain('Ambiguity unresolved');
});

it.each([false,true])('verification expands to third only for genuinely ambiguous first two (%s)',ambiguous=>{
 return (async()=>{
 const f=fixture(),good=maskedDescriptor(f.image,f.segment);
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({putImageData:()=>{}})})});vi.stubGlobal('ImageData',class {constructor(..._:unknown[]) {}});
 // Separate identical green objects preserve a real ambiguity after segmentation.
 for(let y=25;y<49;y++)for(let x=60;x<80;x++){const i=(y*100+x)*4;f.image.data[i]=40;f.image.data[i+1]=180;f.image.data[i+2]=60;}
 const mask=new Uint8Array(8000);for(let y=25;y<49;y++)for(let x=60;x<80;x++)mask[y*100+x]=1;
 const second=summarizeMask(mask,100,80);
 const sam={ready:true,capture:vi.fn(async()=>{}),select:vi.fn(async(x:number)=>x>55?second:f.segment)};
 const verify=createSAMVerifier(()=>sam,[ref(f.image,f.segment)],async()=>good);
 const result=await verify(f.image,[c(30,.99),c(60,ambiguous?.98:.1),c(5,ambiguous?.97:.09)],new AbortController().signal);
 expect(sam.select).toHaveBeenCalledTimes(ambiguous?3:1);
 expect(result.verificationAttempts).toBe(ambiguous?3:1);
 })();
});

it('rejected second mask resolves ambiguity and the same verified object reaches three matches',async()=>{
 const f=fixture(),good=maskedDescriptor(f.image,f.segment);
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({putImageData:()=>{}})})});vi.stubGlobal('ImageData',class {constructor(..._:unknown[]) {}});
 // The second center is outside the returned mask: a rejected object, not an untested rival.
 const sam={ready:true,capture:vi.fn(async()=>{}),select:vi.fn(async()=>f.segment)};
 const verify=createSAMVerifier(()=>sam,[ref(f.image,f.segment)],async()=>good);
 const {tracker,update}=setup((image,_,signal)=>verify(image,[c(30,.91),c(65,.89)],signal));
 for(const [i,t] of [900,1200,1500].entries()) {update(t);await flush();await flush();expect(tracker.diagnostics.stableCount).toBe(i+1);}
 expect(sam.select).toHaveBeenCalledTimes(6);expect(tracker.state).toBe('TRACKING');expect(tracker.diagnostics.verifiedSecond).toBeNull();
});
it('91 versus 84 coarse scores require only the best SAM prompt',async()=>{
 const f=fixture();vi.stubGlobal('document',{createElement:()=>({getContext:()=>({putImageData:()=>{}})})});vi.stubGlobal('ImageData',class {constructor(..._:unknown[]) {}});
 const sam={ready:true,capture:vi.fn(async()=>{}),select:vi.fn(async()=>f.segment)};
 const result=await createSAMVerifier(()=>sam,[ref(f.image,f.segment)],async()=>maskedDescriptor(f.image,f.segment))(f.image,[c(30,.91),c(65,.84)],new AbortController().signal);
 expect(sam.select).toHaveBeenCalledTimes(1);expect(result.ambiguityClear).toBe(true);
});
it('in-flight verification finishes after deadline; no further cycles start',async()=>{
 let finish!:(v:Awaited<ReturnType<CandidateVerifier>>)=>void;
 const verify=vi.fn<CandidateVerifier>().mockImplementation(()=>new Promise(r=>finish=r));
 const {tracker,update,setTime}=setup(verify);update(900);
 expect(tracker.recoveryStartedAt).toBe(800);
 expect(tracker.age(5900)?.state).toBe('REACQUIRING');expect(tracker.verificationPending).toBe(true);
 update(6000);expect(verify).toHaveBeenCalledTimes(1);
 setTime(6100);finish({candidates:[c()],samMs:5200,verifiedCount:1});await flush();
 expect(tracker.state).toBe('LOST');expect(tracker.diagnostics.verifiedCandidates).toBe(1);expect(tracker.diagnostics.samMs).toBe(5200);
 expect(tracker.diagnostics.verificationStatus).toBe('Recovery timeout');update(6500);expect(verify).toHaveBeenCalledTimes(1);
});
it('LOST retry resets clock and immediately sends a shortlist to verification',async()=>{
 const verify=vi.fn<CandidateVerifier>().mockResolvedValue({candidates:[c()],samMs:20,verifiedCount:1});
 const {tracker,update}=setup(verify);expect(tracker.age(5800)?.state).toBe('LOST');
 tracker.retry(10000);expect(tracker.state).toBe('REACQUIRING');expect(tracker.recoveryStartedAt).toBe(10000);
 expect(tracker.recoveryElapsed(10000)).toBe(0);expect(tracker.recoveryRemaining(10000)).toBe(5000);expect(tracker.retryAttempt).toBe(1);
 update(10000);expect(verify).toHaveBeenCalledTimes(1);expect(verify.mock.calls[0][1].length).toBeGreaterThan(0);
 expect(tracker.verificationRequested).toBe(true);expect(tracker.verificationStarted).toBe(true);await flush();expect(tracker.diagnostics.stableCount).toBe(1);
 expect(tracker.age(14999)?.state).toBe('REACQUIRING');expect(tracker.age(15000)?.state).toBe('LOST');
 tracker.retry(16000);expect(tracker.retryAttempt).toBe(2);expect(tracker.diagnostics.stableCount).toBe(0);update(16000);await flush();expect(tracker.diagnostics.stableCount).toBe(1);
});
it('retry cancels old async results without poisoning the new attempt',async()=>{
 const finishes:((v:Awaited<ReturnType<CandidateVerifier>>)=>void)[]=[];
 const {tracker,update}=setup(()=>new Promise(r=>finishes.push(r)));update(900);tracker.retry(1200);update(1200);
 finishes[0]({candidates:[c(70)],samMs:200,verifiedCount:1});await flush();expect(tracker.diagnostics.stableCount).toBe(0);
 finishes[1]({candidates:[c()],samMs:20,verifiedCount:1});await flush();expect(tracker.diagnostics.stableCount).toBe(1);expect(tracker.recoveryStartedAt).toBe(1200);
});
it('retry without a previous matched box runs global SAM verification instead of initial matching',async()=>{
 const f=fixture(),verify=vi.fn<CandidateVerifier>().mockResolvedValue({candidates:[c()],samMs:20,verifiedCount:1});
 vi.spyOn(performance,'now').mockReturnValue(10000);const tracker=new AppearanceTracker();
 tracker.initializeProfile(saveTargetView([],'Cup',ref(f.image,f.segment))[0],false,100,80,verify);tracker.retry(10000);
 tracker.update(f.image,10000,100,80);await flush();expect(tracker.state).toBe('REACQUIRING');expect(tracker.diagnostics.searchMode).toBe('global');expect(verify).toHaveBeenCalledOnce();expect(tracker.diagnostics.stableCount).toBe(1);
});

it('third fresh verification admitted before expiry can complete after it and reacquire',async()=>{
 let finish!:(v:Awaited<ReturnType<CandidateVerifier>>)=>void;
 const {tracker,update,setTime}=setup(()=>new Promise(r=>finish=r));
 for(const t of [900,1200]) {update(t);finish({candidates:[c()],samMs:20,verifiedCount:1});await flush();}
 update(5700);expect(tracker.age(5800)?.state).toBe('REACQUIRING');setTime(5900);
 finish({candidates:[c()],samMs:200,verifiedCount:1});await flush();expect(tracker.state).toBe('TRACKING');expect(tracker.diagnostics.stableCount).toBe(3);expect(tracker.capturedAt).toBe(5700);
});

it('overlapping SAM masks with changing view and modest motion merge and reach TRACKING',async()=>{
 let n=0;
 const {tracker,update}=setup(async()=>{
   n++;const mask=new Uint8Array(100*80);for(let y=25;y<49;y++)for(let x=30+n;x<50+n;x++)mask[y*100+x]=1;
   const segmentation={mask,width:100,height:80};
   return {candidates:[{...c(30+n,.86,n,20+n,24),segmentation},{...c(26+n,.85,5,32,24),segmentation}],samMs:20,verifiedCount:2,ambiguityClear:true};
 });
 for(const [i,t] of [900,1200,1500].entries()){update(t);await flush();expect(tracker.diagnostics.stableCount).toBe(i+1);expect(tracker.diagnostics.verifiedHypotheses).toBe(1);expect(tracker.diagnostics.mergedDuplicates).toBe(1);}
 expect(tracker.state).toBe('TRACKING');expect(tracker.diagnostics.winningView).toBe(3);expect(tracker.diagnostics.hypothesisDrift).toBeGreaterThan(0);expect(tracker.diagnostics.hypothesisDrift).toBeLessThan(4);
});

it('physical object group remains stable across part winner, scale and center changes',async()=>{
 let n=0;const {tracker,update}=setup(async()=>({candidates:finchHypotheses(n++*3,n===2?1.2:1,n===2),samMs:20,verifiedCount:3,ambiguityClear:true}));
 for(const [i,t] of [900,1200,1500].entries()){update(t);await flush();expect(tracker.diagnostics.stableCount).toBe(i+1);expect(tracker.diagnostics.verifiedHypotheses).toBe(1);expect(tracker.diagnostics.mergedDuplicates).toBe(2);}
 expect(tracker.state).toBe('TRACKING');expect(tracker.verifiedGeometry).toHaveLength(3);
});
it('two separate physical object groups still cannot resume',async()=>{
 const {tracker,update}=setup(async()=>({candidates:[...finchHypotheses(-36,.8),...finchHypotheses(36,.8)],samMs:20,verifiedCount:6,ambiguityClear:true}));
 for(const t of [900,1200,1500]){update(t);await flush();expect(tracker.diagnostics.stableCount).toBe(0);expect(tracker.diagnostics.verifiedHypotheses).toBe(2);}
 expect(tracker.state).toBe('REACQUIRING');
});
