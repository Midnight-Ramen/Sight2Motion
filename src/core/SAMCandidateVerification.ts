import { mergeVerifiedHypotheses, type VerifiedCandidate } from './VerifiedHypotheses';
import { clusterAppearanceCandidates, REACQUISITION, type AppearanceCandidate } from './AppearanceTracker';
import type { MobileSAMSegmenter } from './MobileSAMSegmenter';
import type { SelectedSegment } from './SegmentationGeometry';
import type { TargetReference } from './TargetProfiles';

export type VerificationPixels = Pick<ImageData, 'data' | 'width' | 'height'>;
export const SAM_VERIFICATION = { candidates: 5, coarseAmbiguityMargin: .05, defaultVerifications: 2, maxVerifications: 3, appearanceWeight: .2, descriptorWeight: .6, shapeWeight: .2, distributionWeight: .55, spatialWeight: .45, maskWeight: .5, aspectWeight: .3, fillWeight: .2 };
export interface MaskedDescriptor { histogram: number[]; spatial: number[][]; occupancy: number[]; aspect: number; fill: number }
/** Same masked representation for saved crops and newly segmented objects. Background is excluded. */
export function maskedDescriptor(image: VerificationPixels, segment: SelectedSegment): MaskedDescriptor {
  if(segment.width!==image.width || segment.height!==image.height || segment.mask.length!==image.width*image.height)throw new Error('Verification mask dimensions differ.');
  const b=segment.boundingBox, histogram=Array(16).fill(0), spatial=Array.from({length:16},()=>[0,0,0,0]), occupancy=Array(16).fill(0), cells=Array(16).fill(0);
  let count=0;
  for(let y=Math.max(0,Math.floor(b.y));y<Math.min(image.height,Math.ceil(b.y+b.height));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(image.width,Math.ceil(b.x+b.width));x++) {
    const cell=Math.min(3,Math.floor((y-b.y)*4/b.height))*4+Math.min(3,Math.floor((x-b.x)*4/b.width));cells[cell]++;
    if(!segment.mask[y*image.width+x])continue;
    const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],blue=image.data[i+2],sum=Math.max(30,r+g+blue);
    const red=r/sum,green=g/sum;
    histogram[Math.min(3,Math.floor(red*4))*4+Math.min(3,Math.floor(green*4))]++;
    spatial[cell][0]+=red;spatial[cell][1]+=green;spatial[cell][2]+=blue/sum;spatial[cell][3]++;
    occupancy[cell]++;count++;
  }
  if(count<8)throw new Error('Verification mask is too small.');
  return {histogram:histogram.map(n=>n/count),spatial:spatial.map(s=>s[3]?s.slice(0,3).map(n=>n/s[3]):[]),occupancy:occupancy.map((n,i)=>n/Math.max(1,cells[i])),aspect:b.width/b.height,fill:count/(b.width*b.height)};
}
export function compareMaskedDescriptors(a: MaskedDescriptor,b: MaskedDescriptor) {
  const distribution=a.histogram.reduce((n,v,i)=>n+Math.min(v,b.histogram[i]),0);
  let spatial=0,common=0;
  for(let i=0;i<16;i++)if(a.spatial[i].length && b.spatial[i].length){spatial+=Math.max(0,1-a.spatial[i].reduce((n,v,c)=>n+Math.abs(v-b.spatial[i][c]),0)/.6);common++;}
  const mask=1-a.occupancy.reduce((n,v,i)=>n+Math.abs(v-b.occupancy[i]),0)/16;
  const aspect=Math.min(a.aspect,b.aspect)/Math.max(a.aspect,b.aspect),fill=Math.min(a.fill,b.fill)/Math.max(a.fill,b.fill);
  return {descriptor:SAM_VERIFICATION.distributionWeight*distribution+SAM_VERIFICATION.spatialWeight*(common?spatial/common:0),shape:SAM_VERIFICATION.maskWeight*mask+SAM_VERIFICATION.aspectWeight*aspect+SAM_VERIFICATION.fillWeight*fill};
}
export function verifiedAppearanceScore(coarse:number,similarity:ReturnType<typeof compareMaskedDescriptors>) {
  return SAM_VERIFICATION.appearanceWeight*coarse+SAM_VERIFICATION.descriptorWeight*similarity.descriptor+SAM_VERIFICATION.shapeWeight*similarity.shape;
}
const referenceCache=new WeakMap<TargetReference,Promise<MaskedDescriptor>>();
export function referenceDescriptor(reference:TargetReference):Promise<MaskedDescriptor> {
  let pending=referenceCache.get(reference);
  if(!pending){pending=(async()=>{
    const img=new Image();img.src=reference.crop.image;await img.decode();
    const {width,height}=reference.crop,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0,width,height);
    const mask=Uint8Array.from(atob(reference.crop.mask),c=>c.charCodeAt(0));
    return maskedDescriptor(ctx.getImageData(0,0,width,height),{mask,width,height,boundingBox:{x:0,y:0,width,height},area:0,centroid:{x:width/2,y:height/2}});
  })();referenceCache.set(reference,pending);pending.catch(()=>referenceCache.delete(reference));}
  return pending;
}
export interface VerificationResult { candidates: VerifiedCandidate[]; samMs: number; verifiedCount: number; ambiguityClear?: boolean; verificationAttempts?: number }
export type CandidateVerifier = (image:VerificationPixels,candidates:readonly AppearanceCandidate[],signal:AbortSignal)=>Promise<VerificationResult>;
/** One encode per cycle, sequential prompts through the existing single worker. */
export function createSAMVerifier(service:()=>Pick<MobileSAMSegmenter, 'ready' | 'capture' | 'select'>|null,references:readonly TargetReference[],loadReference=referenceDescriptor):CandidateVerifier {
  return async(image,candidates,signal)=>{
    const check=()=>{if(signal.aborted)throw new Error('Verification cancelled.');};check();
    const sam=service();if(!sam?.ready)throw new Error('MobileSAM verification unavailable.');
    const descriptors=await Promise.all(references.map(loadReference));check();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
    let samMs=0,verifiedCount=0,attempts=0;const verified:VerifiedCandidate[]=[];
    let started=performance.now();await sam.capture(canvas);samMs+=performance.now()-started;check();
    const ranked=clusterAppearanceCandidates(candidates).slice(0,SAM_VERIFICATION.candidates);
    // Coarse separation selects which hypotheses require verification, not the
    // verified confidence threshold. Rejected masks are not unseen competitors.
    const contenders=ranked.filter(candidate=>ranked[0].score-candidate.score<SAM_VERIFICATION.coarseAmbiguityMargin);
    let verificationFailed=false;
    for(const candidate of contenders) {
      const distinct=mergeVerifiedHypotheses(verified).hypotheses,leader=distinct[0];
      if(attempts>=SAM_VERIFICATION.maxVerifications)break;
      if(attempts>=SAM_VERIFICATION.defaultVerifications && !(distinct[1] && leader.score-distinct[1].score<REACQUISITION.ambiguityMargin))break;
      attempts++;
      check();const b=candidate.box,x=b.x+b.width/2,y=b.y+b.height/2;
      started=performance.now();let segment:SelectedSegment;
      try {segment=await sam.select(x,y);}catch(error){check();verificationFailed=true;samMs+=performance.now()-started;continue;}
      samMs+=performance.now()-started;check();
      // A prompt must identify a mask containing its own source-frame center.
      if(segment.width!==image.width || segment.height!==image.height || !segment.mask[Math.floor(y)*image.width+Math.floor(x)])continue;
      let descriptor:MaskedDescriptor;try{descriptor=maskedDescriptor(image,segment);}catch{continue;}
      verifiedCount++;
      let best:VerifiedCandidate|undefined;
      descriptors.forEach((reference,view)=>{
        const score=verifiedAppearanceScore(candidate.score,compareMaskedDescriptors(descriptor,reference));
        if(!best || score>best.score)best={box:{...segment.boundingBox},score,view:view+1,scale:candidate.scale,segmentation:{mask:segment.mask.slice(),width:segment.width,height:segment.height}};
      });
      if(best)verified.push(best);
    }
    check();
    const distinct=mergeVerifiedHypotheses(verified).hypotheses,best=distinct[0];
    const unseen=contenders.slice(attempts);
    const ambiguityClear=!!best && !verificationFailed && unseen.length===0;
    return {candidates:verified,samMs,verifiedCount,ambiguityClear,verificationAttempts:attempts};
  };
}
