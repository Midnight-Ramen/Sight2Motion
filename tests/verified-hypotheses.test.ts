import {expect,it} from 'vitest';
import {finchHypotheses} from './finch-hypotheses-fixture';
import {mergeVerifiedHypotheses,rankVerifiedHypotheses,type VerifiedCandidate} from '../src/core/VerifiedHypotheses';
const candidate=(x=20,score=.86,w=20):VerifiedCandidate=>({box:{x,y:20,width:w,height:20},score,view:1,scale:1});
function masked(c:VerifiedCandidate,left=20,right=40) {const mask=new Uint8Array(100*80);for(let y=20;y<40;y++)for(let x=left;x<right;x++)mask[y*100+x]=1;return {...c,segmentation:{mask,width:100,height:80}};}
it('high mask IoU merges refined boxes with different extents, retaining best score',()=>{
 const best=masked(candidate(15,.86,30)),second=masked(candidate(20,.85,20),21,40);
 const result=mergeVerifiedHypotheses([second,best]);expect(result.hypotheses).toHaveLength(1);expect(result.hypotheses[0]).toMatchObject(best);expect(result.mergedDuplicates).toBe(1);
});
it('strong refined-box overlap and close centers merge without masks',()=>{
 expect(mergeVerifiedHypotheses([candidate(),candidate(23,.85,22)]).hypotheses).toHaveLength(1);
});
it('disjoint masks and separate objects remain distinct even when bounding boxes overlap',()=>{
 expect(mergeVerifiedHypotheses([masked(candidate(),20,28),masked(candidate(21,.85),32,40)]).hypotheses).toHaveLength(2);
 expect(mergeVerifiedHypotheses([masked(candidate()),masked(candidate(65,.85),65,85)]).hypotheses).toHaveLength(2);
});
it('duplicate chains cannot bridge multiple physical objects',()=>{
 expect(mergeVerifiedHypotheses([candidate(20,.89),candidate(24,.88),candidate(28,.87)]).hypotheses).toHaveLength(2);
});
it('modest temporal prior does not resolve two genuinely close-scoring objects',()=>{
 const a=candidate(),b=candidate(65,.85);const result=rankVerifiedHypotheses([a,b],a.box,1);
 expect(result.margin).toBeLessThan(.06);expect(result.hypotheses[0].score).toBe(.86);
});
it('temporal prior resolves only a borderline margin with strong spatial continuity',()=>{
 const a=candidate(20,.9),b=candidate(65,.86);const result=rankVerifiedHypotheses([b,a],a.box,1);
 expect(result.margin).toBeGreaterThan(.06);expect(result.hypotheses[0]).toBe(a);expect(rankVerifiedHypotheses([a,b],a.box,0).margin).toBeCloseTo(.04);
});

it('Finch body/front/top masks group despite low part-to-body IoU, recording exact geometry',()=>{
 const result=mergeVerifiedHypotheses(finchHypotheses());
 expect(result.hypotheses).toHaveLength(1);expect(result.mergedDuplicates).toBe(2);expect(result.hypotheses[0].score).toBe(.92);
 expect(result.records[0]).toMatchObject({center:{x:76,y:55},box:{x:44,y:30,width:64,height:50},maskBox:{x:44,y:30,width:64,height:50},maskArea:3200,view:1,score:.92});
 expect(result.records[1]).toMatchObject({center:{x:86,y:64.5},box:{x:68,y:52,width:36,height:25},maskArea:900,view:4,score:.9,rule:'contained object part',group:1});
 console.log('Physical-style synthetic fixture:',JSON.stringify(result.records));
});
it('highest-scoring part wins while retaining the full object extent for temporal identity',()=>{
 const result=mergeVerifiedHypotheses(finchHypotheses(0,1,true));expect(result.hypotheses).toHaveLength(1);expect(result.hypotheses[0].view).toBe(4);expect(result.hypotheses[0].score).toBe(.93);expect(result.hypotheses[0].objectBox).toEqual({x:44,y:30,width:64,height:50});
});
it('two similar nearby robots keep separate groups even with subordinate parts',()=>{
 const result=mergeVerifiedHypotheses([...finchHypotheses(-36,.8),...finchHypotheses(36,.8)]);
 expect(result.hypotheses).toHaveLength(2);expect(result.mergedDuplicates).toBe(4);
 expect(rankVerifiedHypotheses(result.hypotheses,result.hypotheses[0].objectBox!,1).margin).toBeLessThan(.06);
});
it('nested boxes with disjoint object masks are not absorbed',()=>{
 const [body,front]=finchHypotheses();const mask=body.segmentation!.mask.slice();for(let i=0;i<mask.length;i++)if(front.segmentation!.mask[i])mask[i]=0;
 expect(mergeVerifiedHypotheses([{...body,segmentation:{...body.segmentation!,mask}},front]).hypotheses).toHaveLength(2);
});
