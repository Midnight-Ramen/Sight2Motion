import { displayedX } from './CameraOrientation';
import { associateSelection } from './SAMAssociation';
import { CLASSES } from './VisionEngine';
import type { SelectedSegment } from './SegmentationGeometry';
import { hasBoundingBox, type Detection, type VisionResult } from './types';

type Box = SelectedSegment['boundingBox'];
export type TrackingState = 'IDLE' | 'SAM_SELECTED' | 'MATCHING' | 'TRACKING' | 'TEMPORARILY_LOST' | 'LOST';
export interface SelectedTarget extends SelectedSegment { selectedAt: number; initialBoundingBox: Box }
export interface TrackedTarget {
  displayName?: string;
  detectorLabel?: string;
  detectorClassId?: number | null;
  active: boolean; state: TrackingState; label: string;
  centerX: number; centerY: number; boundingBox: Box;
  relativeX: number; relativeY: number; normalizedWidth: number; normalizedHeight: number;
  normalizedArea: number; size: number; errorX: number; horizontalError: number;
  confidence: number; trackingConfidence: number; lostFrames: number; targetLost: boolean;
}
export const TRACKING_DEFAULTS = { initialIou: 0.35, alpha: 0.3, lossMs: 750,
  maxLossMs: 2500, maxCenterJump: 0.12, minSizeSimilarity: 0.4, ambiguityMargin: 0.04 };
export function boxIou(a: Box, b: Box) {
  const area = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
    Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area / Math.max(1, a.width*a.height+b.width*b.height-area);
}
const valid = (d: Detection) => [d.x,d.y,d.width,d.height,d.confidence].every(Number.isFinite) && d.width>0 && d.height>0;
const center = (b: Box) => ({ x:b.x+b.width/2, y:b.y+b.height/2 });
/** Numeric association only. Inputs and output boxes are in displayed camera orientation. */
export class TargetTracker {
  selected: SelectedTarget | null = null;
  state: TrackingState = 'IDLE';
  private target: TrackedTarget | null = null;
  private raw: Box | null = null;
  private width = 1; private height = 1;
  private lastSeen = 0; private lastUpdate = 0; private cadence = 250;
  private velocity = { x:0, y:0 };
  constructor(readonly config = TRACKING_DEFAULTS) {}
  getTrackedTarget() { return this.target; }
  get lossTimeoutMs() { return Math.min(this.config.maxLossMs, Math.max(this.config.lossMs, this.cadence*2.5)); }
  stop() { this.selected=null; this.target=null; this.raw=null; this.state='IDLE'; this.velocity={x:0,y:0}; this.cadence=250; }
  initialize(segment: SelectedSegment, detections: VisionResult[], mirror: boolean, now = performance.now()) {
    this.stop(); this.state='SAM_SELECTED';
    this.width=segment.width; this.height=segment.height;
    const b=segment.boundingBox;
    const box={...b,x:displayedX(b.x,segment.width,mirror,b.width)};
    this.selected={...segment, initialBoundingBox:box, selectedAt:now};
    this.state='MATCHING';
    const match=associateSelection(segment,detections,mirror,this.config.initialIou);
    if(!match) { this.state='SAM_SELECTED'; return null; }
    const best={d:match.detection,overlap:match.iou};
    this.selected.detectorLabel=best.d.className;
    this.lastSeen=this.lastUpdate=now; this.raw={x:best.d.x,y:best.d.y,width:best.d.width,height:best.d.height};
    this.target=this.makeTarget(this.raw,best.d.className,best.d.confidence,match.score,0,'TRACKING');
    this.state='TRACKING';
    console.info('SAM target locked', {label:best.d.className,initialIou:best.overlap});
    return this.target;
  }
  private makeTarget(boundingBox: Box,label:string,confidence:number,trackingConfidence:number,lostFrames:number,state:TrackingState):TrackedTarget {
    const p=center(boundingBox), normalizedWidth=boundingBox.width/this.width, normalizedHeight=boundingBox.height/this.height;
    const normalizedArea=normalizedWidth*normalizedHeight;
    return {active:true,state,label,displayName:this.selected?.displayName?.trim() || 'Selected object',detectorLabel:label,
      detectorClassId:CLASSES.includes(label)?CLASSES.indexOf(label):null,boundingBox,centerX:p.x,centerY:p.y,relativeX:p.x/this.width,relativeY:p.y/this.height,
      normalizedWidth,normalizedHeight,normalizedArea,size:normalizedArea,errorX:p.x-this.width/2,
      horizontalError:(p.x-this.width/2)/(this.width/2),confidence,trackingConfidence,lostFrames,targetLost:state==='LOST'};
  }
  update(detections: VisionResult[], now = performance.now()) {
    if(!this.target || !this.raw || now<=this.lastUpdate) return this.target;
    const dt=now-this.lastUpdate;
    this.cadence=0.7*this.cadence+0.3*Math.min(2000,dt); this.lastUpdate=now;
    const elapsed=now-this.lastSeen, horizon=this.state==='LOST'?0:Math.min(elapsed,this.lossTimeoutMs);
    const predicted={...this.raw,x:this.raw.x+this.velocity.x*horizon,y:this.raw.y+this.velocity.y*horizon};
    const previousCenter=center(predicted), diagonal=Math.hypot(this.width,this.height);
    const candidates=detections.filter(hasBoundingBox).filter(d=>d.className===this.target!.label && valid(d)).map(d=>{
      const p=center(d), distance=Math.hypot(p.x-previousCenter.x,p.y-previousCenter.y)/diagonal;
      const size=Math.min(d.width*d.height,this.raw!.width*this.raw!.height)/Math.max(d.width*d.height,this.raw!.width*this.raw!.height);
      const overlap=boxIou(predicted,d);
      return {d,distance,size,score:0.55*overlap+0.25*Math.max(0,1-distance/this.config.maxCenterJump)+0.15*size+0.05*d.confidence};
    }).filter(c=>c.distance<=this.config.maxCenterJump && c.size>=this.config.minSizeSimilarity)
      .sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    // Ambiguous crossings are a temporary loss, not permission to swap identities.
    if(!best || (candidates[1] && best.score-candidates[1].score<this.config.ambiguityMargin)) {
      this.target={...this.target,lostFrames:this.target.lostFrames+1}; return this.age(now,true);
    }
    const p=center(best.d), old=center(this.raw);
    if(elapsed>0 && elapsed<=this.lossTimeoutMs) {
      this.velocity={x:0.5*this.velocity.x+0.5*(p.x-old.x)/elapsed,y:0.5*this.velocity.y+0.5*(p.y-old.y)/elapsed};
    } else this.velocity={x:0,y:0};
    const a=this.config.alpha, b=this.target.boundingBox;
    const smooth={x:b.x+(best.d.x-b.x)*a,y:b.y+(best.d.y-b.y)*a,
      width:b.width+(best.d.width-b.width)*a,height:b.height+(best.d.height-b.height)*a};
    this.raw={x:best.d.x,y:best.d.y,width:best.d.width,height:best.d.height}; this.lastSeen=now;
    if(this.state!=='TRACKING') console.info('Target tracking resumed',this.target.label);
    this.state='TRACKING';
    this.target=this.makeTarget(smooth,this.target.label,best.d.confidence,best.score,0,'TRACKING');
    return this.target;
  }
  /** Age the last result even when inference or the camera stops producing frames. */
  age(now = performance.now(), missingFrame = false) {
    if(!this.target) return null;
    const age=now-this.lastSeen;
    const state:TrackingState=this.state==='LOST'||age>=this.lossTimeoutMs?'LOST':missingFrame||this.target.lostFrames>0||age>Math.max(300,this.cadence*1.5)?'TEMPORARILY_LOST':'TRACKING';
    if(state!==this.state) console.info('Target tracking',state);
    this.state=state;
    if(state!=='TRACKING') this.target={...this.target,state,targetLost:state==='LOST',trackingConfidence:Math.max(0,1-age/this.lossTimeoutMs)*this.target.confidence};
    return this.target;
  }
}
