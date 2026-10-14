import type { AppearanceCandidate } from './AppearanceTracker';
import type { SelectedSegment } from './SegmentationGeometry';

type Box = AppearanceCandidate['box'];
export type VerifiedCandidate = AppearanceCandidate & {
  segmentation?: Pick<SelectedSegment, 'mask' | 'width' | 'height'>;
  /** Object extent retained independently of whichever part/view has the best score. */
  objectBox?: Box;
};
export const VERIFIED_IDENTITY = {
  maskIoU: .6, boxIoU: .55, centerFraction: .25, temporalBonus: .025,
  maskContainment: .85, boxContainment: .85, minPartAreaRatio: .15, partCenterFraction: .5,
  temporalCenterFraction: .4, temporalSizeRatio: .65
};
export function hypothesisDrift(a: Box, b: Box) {
  return Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2);
}
function relation(a: VerifiedCandidate,b: VerifiedCandidate):string|null {
  const x=a.box,y=b.box,areaX=x.width*x.height,areaY=y.width*y.height;
  const intersection=Math.max(0,Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x))*Math.max(0,Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y));
  const boxIoU=intersection/(areaX+areaY-intersection),boxContainment=intersection/Math.min(areaX,areaY);
  let maskIoU:number|undefined,maskContainment:number|undefined;
  if(a.segmentation && b.segmentation && a.segmentation.width===b.segmentation.width && a.segmentation.height===b.segmentation.height) {
    let overlap=0,countA=0,countB=0;
    for(let i=0;i<a.segmentation.mask.length;i++) {const l=!!a.segmentation.mask[i],r=!!b.segmentation.mask[i];if(l)countA++;if(r)countB++;if(l&&r)overlap++;}
    maskIoU=overlap/Math.max(1,countA+countB-overlap);
    maskContainment=overlap/Math.max(1,Math.min(countA,countB));
    if(maskIoU>=VERIFIED_IDENTITY.maskIoU)return 'mask IoU';
  }
  const drift=hypothesisDrift(x,y);
  if(boxIoU>=VERIFIED_IDENTITY.boxIoU && drift<=Math.min(x.width,x.height,y.width,y.height)*VERIFIED_IDENTITY.centerFraction && (maskIoU===undefined || maskIoU>=.15))return 'refined overlap + close centers';
  const larger=areaX>=areaY?x:y;
  // A contained part may have very low IoU with the whole robot. Require
  // agreement in mask containment AND geometry when masks are available.
  // Disjoint masks never merge merely because their boxes are nested/nearby.
  if(boxContainment>=VERIFIED_IDENTITY.boxContainment &&
    Math.min(areaX,areaY)/Math.max(areaX,areaY)>=VERIFIED_IDENTITY.minPartAreaRatio &&
    drift<=Math.max(larger.width,larger.height)*VERIFIED_IDENTITY.partCenterFraction &&
    (maskContainment===undefined || maskContainment>=VERIFIED_IDENTITY.maskContainment))return 'contained object part';
  return null;
}
export function verifiedCandidateGeometry(candidate:VerifiedCandidate) {
  const b=candidate.box,s=candidate.segmentation;let area=0,left=Infinity,top=Infinity,right=-1,bottom=-1;
  if(s)for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)if(s.mask[y*s.width+x]) {area++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {center:{x:b.x+b.width/2,y:b.y+b.height/2},box:{...b},maskBox:area?{x:left,y:top,width:right-left+1,height:bottom-top+1}:null,maskArea:s?area:null,view:candidate.view,score:candidate.score};
}
export function mergeVerifiedHypotheses(candidates:readonly VerifiedCandidate[]) {
  // Largest supported object anchors the group so top/front masks can both
  // attach to a body mask, even when the best score belongs to one small part.
  // Every member must directly agree with the anchor: no transitive chains.
  const groups:{anchor:VerifiedCandidate;members:{candidate:VerifiedCandidate;rule:string}[]}[]=[];
  for(const candidate of [...candidates].sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height || b.score-a.score)) {
    let rule:string|null=null;
    const group=groups.find(g=>{rule=relation(g.anchor,candidate);return !!rule;});
    if(group)group.members.push({candidate,rule:rule!});
    else groups.push({anchor:candidate,members:[{candidate,rule:'object anchor'}]});
  }
  const hypotheses=groups.map(g=>{
    const best=[...g.members].sort((a,b)=>b.candidate.score-a.candidate.score)[0].candidate;
    return g.members.length===1?best:{...best,objectBox:{...g.anchor.box}};
  }).sort((a,b)=>b.score-a.score);
  const records=groups.flatMap((g,group)=>g.members.map(({candidate,rule})=>({...verifiedCandidateGeometry(candidate),group:group+1,rule}))).sort((a,b)=>b.score-a.score);
  return {hypotheses,mergedDuplicates:candidates.length-hypotheses.length,records};
}
export function consistentVerifiedObject(a:Box,b:Box) {
  const sizeRatio=Math.min(a.width/b.width,b.width/a.width,a.height/b.height,b.height/a.height);
  return sizeRatio>=VERIFIED_IDENTITY.temporalSizeRatio && hypothesisDrift(a,b)<=Math.max(4,Math.min(a.width,a.height,b.width,b.height)*VERIFIED_IDENTITY.temporalCenterFraction);
}
/** Small spatial tie-break only; never raises a candidate's confidence. */
export function rankVerifiedHypotheses(candidates:readonly VerifiedCandidate[],anchor:AppearanceCandidate['box'],priorWeight:number) {
  const ranked=candidates.map(candidate=>{
    const b=candidate.objectBox ?? candidate.box,size=Math.min(b.width/anchor.width,anchor.width/b.width,b.height/anchor.height,anchor.height/b.height);
    const proximity=Math.max(0,1-hypothesisDrift(b,anchor)/Math.max(anchor.width,anchor.height));
    return {candidate,rank:candidate.score+VERIFIED_IDENTITY.temporalBonus*Math.max(0,Math.min(1,priorWeight))*size*proximity};
  }).sort((a,b)=>b.rank-a.rank);
  return {hypotheses:ranked.map(r=>r.candidate),margin:ranked[1]?ranked[0].rank-ranked[1].rank:1};
}
