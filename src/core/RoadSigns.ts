import type { VisionResult } from './types';
import type { LineEventMode } from './FinchNavigation';
export type RoadSignAction=LineEventMode|'resume';
export type RoadSignMapping={className:string;action:LineEventMode};
export type RoadSignVision={items:VisionResult[];capturedAt:number;classes:readonly string[];confidence:number;ready:boolean;scope:string};
export const ROAD_SIGNS={stableMs:250,rearmMs:500,maxFrameAgeMs:1500} as const;
/** Consumes existing model results only. No inference, timers, or motor access. */
export class RoadSignDetector {
 private last=-Infinity;
 private holding=false;
 private states=new Map<string,{since:number|null;absent:number|null;latched:boolean}>();
 reset(){this.holding=false;this.last=-Infinity;this.states.clear();}
 update(items:VisionResult[],capturedAt:number,now:number,threshold:number,mappings:RoadSignMapping[]):RoadSignAction|undefined{
  if(!Number.isFinite(capturedAt)||capturedAt<=this.last||now<capturedAt||now-capturedAt>ROAD_SIGNS.maxFrameAgeMs)return;
  if(capturedAt-this.last>ROAD_SIGNS.maxFrameAgeMs)for(const s of this.states.values()){s.since=null;s.absent=null;}
  this.last=capturedAt;const triggered:LineEventMode[]=[];
  for(const m of mappings){
   const s=this.states.get(m.className)??{since:null,absent:null,latched:false};this.states.set(m.className,s);
   const present=items.some(d=>d.className===m.className&&Number.isFinite(d.confidence)&&d.confidence>=threshold);
   if(present){s.absent=null;if(s.since===null)s.since=capturedAt;
    if(!s.latched&&capturedAt-s.since>=ROAD_SIGNS.stableMs){s.latched=true;triggered.push(m.action);}
   }else{s.since=null;if(s.absent===null)s.absent=capturedAt;if(capturedAt-s.absent>=ROAD_SIGNS.rearmMs)s.latched=false;}
  }
  if(triggered.includes('stop')){this.holding=true;return 'stop';}
  if(this.holding){
   const stops=mappings.filter(m=>m.action==='stop');
   if(stops.length&&stops.every(m=>{const s=this.states.get(m.className);return s?.absent!==null&&s?.absent!==undefined&&capturedAt-s.absent>=ROAD_SIGNS.rearmMs;})){
    this.holding=false;return 'resume';
   }
   return;
  }
  return triggered.find(a=>a!=='continue')??triggered[0];
 }
}
