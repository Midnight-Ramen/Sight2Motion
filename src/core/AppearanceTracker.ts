import type { AppearanceTemplate, TargetProfile } from './TargetProfiles';
import { displayedX } from './CameraOrientation';
import type { SelectedSegment } from './SegmentationGeometry';
import type { TrackedTarget } from './TargetTracker';

type Pixels = Pick<ImageData, 'data' | 'width' | 'height'>;
type Box = SelectedSegment['boundingBox'];
type Candidate = { box: Box; score: number; view: number; scale: number };
type Descriptor = { object: AppearanceTemplate['samples']; context: AppearanceTemplate['samples']; mean: number; deviation: number; contrast: number };
export const APPEARANCE_SEARCH = { scales: [.65, .8, 1, 1.2, 1.4], objectSamples: 64, contextSamples: 20, peaksPerScale: 2, refineStep: 1 };

export const APPEARANCE_STABILITY = { alpha: .65, acquireConfidence: .72, retainConfidence: .67, ambiguityMargin: .035 };
export const REACQUISITION = { windowMs: 5000, intervalMs: 250, confidence: .78, ambiguityMargin: .06, stableFrames: 3, gridStep: 6 };
/** Fixed reference templates: never learn background after an uncertain match. */
export class AppearanceTracker {
  readonly lossTimeoutMs = 750;
  diagnostics = { margin: 0, bestMatch: 0, winningView: 0, searchMode: 'local' as 'local' | 'global', searchRadius: 0, candidateScale: 1, searchMs: 0, candidates: 0 };
  private descriptors = new WeakMap<AppearanceTemplate, Descriptor>();
  private motion = 0;

  private lostSince: number | null = null;
  private lastGlobal = -Infinity;
  private candidate?: Box;
  private stable = 0;
  private profileTracking = false;
  reacquired = false;
  private samples: AppearanceTemplate['samples'] = [];
  private references: AppearanceTemplate[] = [];
  private matchThreshold?: number;
  private box!: Box;
  private target: TrackedTarget | null = null;
  private lastSeen = -Infinity;
  private lastFrame = -Infinity;
  private width = 0;
  private height = 0;
  private mirror = false;
  private name = '';
  get capturedAt() { return this.lastSeen; }
  stop() { this.motion=0; this.descriptors=new WeakMap(); this.diagnostics={margin:0,bestMatch:0,winningView:0,searchMode:'local',searchRadius:0,candidateScale:1,searchMs:0,candidates:0}; this.lostSince=null; this.lastGlobal=-Infinity; this.candidate=undefined; this.stable=0; this.profileTracking=false; this.reacquired=false; this.target = null; this.samples = []; this.references = []; this.matchThreshold = undefined; this.lastSeen = this.lastFrame = -Infinity; }
  initialize(image: Pixels, selection: SelectedSegment, mirror: boolean) {
    this.stop(); this.width = image.width; this.height = image.height; this.mirror = mirror;
    this.name = selection.displayName?.trim() || 'Selected object';
    const sx = image.width / selection.width, sy = image.height / selection.height;
    const b = selection.boundingBox;
    this.box = { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy };
    if (this.box.width < 5 || this.box.height < 5) throw new Error('Select a larger object for appearance tracking.');
    // Include a narrow context band to distinguish a solid cup from a solid wall.
    for (let iy = -1; iy <= 12; iy++) for (let ix = -1; ix <= 12; ix++) {
      const u = (ix + .5) / 12, v = (iy + .5) / 12;
      const x = Math.floor(b.x + u * b.width), y = Math.floor(b.y + v * b.height);
      const inside = x >= 0 && y >= 0 && x < selection.width && y < selection.height && selection.mask[y * selection.width + x];
      const rgb = this.pixel(image, this.box.x + u * this.box.width, this.box.y + v * this.box.height);
      if (rgb) this.samples.push({ u, v, rgb, weight: inside ? 1 : .35 });
    }
    if (this.samples.length < 20) throw new Error('Not enough visible object detail. Capture another frame.');
    this.references = [{ width: this.width, height: this.height, box: { ...this.box }, samples: this.samples }];
  }
  static reference(image: Pixels, selection: SelectedSegment): AppearanceTemplate {
    const tracker = new AppearanceTracker(); tracker.initialize(image, selection, false);
    return tracker.references[0];
  }
  initializeProfile(profile: TargetProfile, mirror: boolean, width: number, height: number) {
    this.stop();
    if (!profile.references.length) throw new Error('Capture a reference view before tracking.');
    if (!Number.isFinite(profile.matchThreshold) || profile.matchThreshold < .01 || profile.matchThreshold > 1) throw new Error('Choose a valid target-match threshold.');
    this.width=width; this.height=height; this.mirror=mirror; this.name=profile.label; this.matchThreshold=profile.matchThreshold;
    this.profileTracking=true;
    this.references=profile.references.map(r=>r.appearance);
    this.samples=this.references[0].samples;
    const seed=this.references.at(-1)!;
    this.box={x:seed.box.x*width/seed.width,y:seed.box.y*height/seed.height,width:seed.box.width*width/seed.width,height:seed.box.height*height/seed.height};
    if(this.box.width<5||this.box.height<5) { this.stop(); throw new Error('Capture a larger target view for this camera.'); }
  }
  private pixel(image: Pixels, x: number, y: number) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const i = (y * image.width + x) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  }
  private descriptor(reference: AppearanceTemplate): Descriptor {
    const cached=this.descriptors.get(reference); if(cached)return cached;
    const pick=(items: AppearanceTemplate['samples'],limit:number)=>items.filter((_,i)=>i%Math.max(1,Math.ceil(items.length/limit))===0);
    // Existing weight=1 samples identify the SAM mask. Never rewrite saved views.
    const object=pick(reference.samples.filter(s=>s.weight>=.9),APPEARANCE_SEARCH.objectSamples);
    const context=pick(reference.samples.filter(s=>s.weight<.9),APPEARANCE_SEARCH.contextSamples);
    const luminance=(rgb:number[])=>.299*rgb[0]+.587*rgb[1]+.114*rgb[2];
    const mean=object.reduce((n,s)=>n+luminance(s.rgb),0)/Math.max(1,object.length);
    const deviation=Math.sqrt(object.reduce((n,s)=>n+(luminance(s.rgb)-mean)**2,0)/Math.max(1,object.length));
    const contrast=context.reduce((n,s)=>n+Math.abs(luminance(s.rgb)-mean),0)/Math.max(1,context.length);
    const descriptor={object,context,mean,deviation,contrast};this.descriptors.set(reference,descriptor);return descriptor;
  }
  private score(image: Pixels, b: Box, reference: AppearanceTemplate) {
    const d=this.descriptor(reference);if(d.object.length<8)return 0;
    let colorError=0,sum=0,squares=0,covariance=0,coverage=0;
    for(const s of d.object) {
      const x=Math.round(b.x+s.u*b.width),y=Math.round(b.y+s.v*b.height);
      if(x<0||y<0||x>=image.width||y>=image.height)return 0;
      const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],blue=image.data[i+2];
      const total=Math.max(30,r+g+blue),refTotal=Math.max(30,s.rgb[0]+s.rgb[1]+s.rgb[2]);
      // Chromaticity is insensitive to exposure gain; sample positions preserve spatial color.
      const chromaError=(Math.abs(r/total-s.rgb[0]/refTotal)+Math.abs(g/total-s.rgb[1]/refTotal)+Math.abs(blue/total-s.rgb[2]/refTotal))/3;
      colorError+=chromaError;if(chromaError<.08)coverage++;
      const lum=.299*r+.587*g+.114*blue,refLum=.299*s.rgb[0]+.587*s.rgb[1]+.114*s.rgb[2];
      sum+=lum;squares+=lum*lum;covariance+=(refLum-d.mean)*lum;
    }
    const mean=sum/d.object.length,deviation=Math.sqrt(Math.max(0,squares/d.object.length-mean*mean));
    const color=Math.max(0,1-colorError/d.object.length/.18);
    const spatial=d.deviation<8 ? Math.max(0,1-deviation/80) : Math.max(0,Math.min(1,covariance/d.object.length/Math.max(8,deviation)/d.deviation));
    // Compare edge contrast, not the saved background color. A same-color wall must not pass as a cup.
    let boundary=0,visible=0;
    for(const s of d.context) {
      const rgb=this.pixel(image,b.x+s.u*b.width,b.y+s.v*b.height);if(!rgb)continue;
      boundary+=Math.abs(.299*rgb[0]+.587*rgb[1]+.114*rgb[2]-mean);visible++;
    }
    const expected=d.contrast*Math.max(.4,mean/Math.max(20,d.mean));
    const edge=d.context.length && expected>12 ? Math.min(1,boundary/Math.max(1,visible)/expected) : 1;
    const brightness=Math.max(0,1-Math.abs(mean-d.mean)/200);
    return (.6*color+.15*spatial+.2*edge+.05*brightness)*Math.min(1,coverage/d.object.length/.85);
  }
  private distinct(a: Box,b: Box) {
    const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    return intersection/Math.min(a.width*a.height,b.width*b.height)<.45;
  }
  private search(image: Pixels, global: boolean, radius: number): Candidate[] {
    const coarse: Candidate[]=[];
    const step=global?REACQUISITION.gridStep:Math.max(3,Math.ceil(radius/7));
    const b=this.box;
    const evaluate=(cx:number,cy:number,height:number,scale:number)=>{
      let best:Candidate|undefined;
      for(let view=0;view<this.references.length;view++) {
        const ref=this.references[view],width=height*ref.box.width/ref.box.height;
        const box={x:cx-width/2,y:cy-height/2,width,height};
        if(width<5||height<5||width>this.width||height>this.height)continue;
        const score=this.score(image,box,ref);this.diagnostics.candidates++;
        if(!best||score>best.score)best={box,score,view:view+1,scale};
      }
      return best;
    };
    // Distinct saved sizes are searched too, but duplicate dimensions do not multiply work.
    const heights=global?[...new Set(this.references.map(r=>Math.round(r.box.height*this.height/r.height/2)*2))]:[b.height];
    for(const height of heights)for(const scale of APPEARANCE_SEARCH.scales) {
      const h=height*scale;
      const left=global?0:b.x+b.width/2-radius,top=global?0:b.y+b.height/2-radius;
      const right=global?this.width:b.x+b.width/2+radius,bottom=global?this.height:b.y+b.height/2+radius;
      for(let cy=top;cy<=bottom;cy+=step)for(let cx=left;cx<=right;cx+=step){const c=evaluate(cx,cy,h,scale);if(c)coarse.push(c);}
    }
    // Always test the unmodified box: coarse grid spacing must not cause drift at rest.
    const seed=evaluate(b.x+b.width/2,b.y+b.height/2,b.height,1);if(seed)coarse.push(seed);
    coarse.sort((a,b)=>b.score-a.score);
    const peaks: Candidate[]=[];
    for(const scale of APPEARANCE_SEARCH.scales) {
      const selected: Candidate[]=[];
      for(const c of coarse) {
        if(c.scale===scale && selected.every(p=>this.distinct(c.box,p.box)))selected.push(c);
        if(selected.length===APPEARANCE_SEARCH.peaksPerScale)break;
      }
      peaks.push(...selected);
    }
    const refined=[...peaks];
    for(const peak of peaks)for(let dy=-step;dy<=step;dy+=APPEARANCE_SEARCH.refineStep)for(let dx=-step;dx<=step;dx+=APPEARANCE_SEARCH.refineStep){
      const c=evaluate(peak.box.x+peak.box.width/2+dx,peak.box.y+peak.box.height/2+dy,peak.box.height,peak.scale);if(c)refined.push(c);
    }
    return refined.sort((a,b)=>b.score-a.score);
  }
  private globalSearch(image: Pixels) { return this.search(image,true,0); }
  update(image: Pixels, now: number, outputWidth: number, outputHeight: number) {
    if (!Number.isFinite(now) || !this.samples.length || now <= this.lastFrame || this.target?.targetLost) return this.age(now);
    if (this.profileTracking && this.target && (now-this.lastSeen>=this.lossTimeoutMs || this.target.state==='TEMPORARILY_LOST') && this.lostSince===null) this.lostSince=this.lastSeen;
    if (this.lostSince!==null && now-this.lostSince>=REACQUISITION.windowMs) return this.age(now);
    if (!this.profileTracking && this.target && now-this.lastSeen>=this.lossTimeoutMs) return this.age(now);
    this.lastFrame = now;
    if (image.width !== this.width || image.height !== this.height) { this.stop(); return null; }
    const b = this.box, elapsed=Number.isFinite(this.lastSeen)?Math.max(0,now-this.lastSeen):100;
    const radius=Math.min(Math.max(this.width,this.height)*.45,Math.max(10,Math.max(b.width,b.height)*.65+this.motion*Math.min(3,elapsed/100)+elapsed*.025));
    const global = this.profileTracking && this.lostSince!==null;
    if(global && now-this.lastGlobal<REACQUISITION.intervalMs)return this.age(now);
    if(global)this.lastGlobal=now;
    this.diagnostics={...this.diagnostics,searchMode:global?'global':'local',searchRadius:global?Math.max(this.width,this.height):radius,candidates:0};
    const started=performance.now();
    const candidates=global?this.globalSearch(image):this.search(image,false,radius);
    this.diagnostics.searchMs=performance.now()-started;
    const best = candidates[0];
    if(!best){this.stable=0;this.candidate=undefined;return this.age(now);}
    this.diagnostics={...this.diagnostics,bestMatch:best.score,winningView:best.view,candidateScale:best.scale};
    const other = candidates.find(c => this.distinct(c.box,best.box));
    this.diagnostics.margin=other?best.score-other.score:1;
    if (best.score < (global ? Math.max(this.matchThreshold ?? 0, REACQUISITION.confidence) : (this.matchThreshold ?? (this.target ? APPEARANCE_STABILITY.retainConfidence : APPEARANCE_STABILITY.acquireConfidence))) ||
      (other && best.score - other.score < (global ? REACQUISITION.ambiguityMargin : APPEARANCE_STABILITY.ambiguityMargin))) {
      this.stable=0; this.candidate=undefined;
      if(this.profileTracking && this.target && this.lostSince===null)this.lostSince=now;
      if (this.target) this.target = { ...this.target, state: 'TEMPORARILY_LOST', trackingConfidence: 0 };
      return this.age(now);
    }
    if(global) {
      const previous=this.candidate;
      this.stable=previous && Math.hypot(previous.x-best.box.x,previous.y-best.box.y)<=Math.max(4,Math.min(best.box.width,best.box.height)*.3) && Math.abs(previous.width/best.box.width-1)<.25 ? this.stable+1 : 1;
      this.candidate=best.box;
      if(this.stable<REACQUISITION.stableFrames)return this.age(now);
      this.reacquired=true; this.lostSince=null; this.stable=0; this.candidate=undefined;
    }
    this.motion=global?0:.5*this.motion+.5*Math.hypot(best.box.x+best.box.width/2-b.x-b.width/2,best.box.y+best.box.height/2-b.y-b.height/2);
    this.box = best.box; this.lastSeen = now;
    const sx = outputWidth / this.width, sy = outputHeight / this.height;
    const rawWidth = best.box.width * sx, rawHeight = best.box.height * sy;
    const rawX = displayedX(best.box.x * sx, outputWidth, this.mirror, rawWidth), rawY = best.box.y * sy;
    const old = global ? undefined : this.target?.boundingBox, a = APPEARANCE_STABILITY.alpha;
    const width = old ? old.width + a * (rawWidth - old.width) : rawWidth;
    const height = old ? old.height + a * (rawHeight - old.height) : rawHeight;
    const x = old ? old.x + a * (rawX - old.x) : rawX, y = old ? old.y + a * (rawY - old.y) : rawY;
    const centerX = x + width / 2, centerY = y + height / 2;
    const area = width * height / (outputWidth * outputHeight), error = centerX / outputWidth * 2 - 1;
    this.target = { displayName: this.name, label: this.name, detectorLabel: 'appearance', detectorClassId: null,
      active: true, state: 'TRACKING', lastSeenAt: now, centerX, centerY, boundingBox: { x, y, width, height },
      relativeX: centerX / outputWidth, relativeY: centerY / outputHeight, normalizedWidth: width / outputWidth,
      normalizedHeight: height / outputHeight, normalizedArea: area, size: area, errorX: error, horizontalError: error,
      confidence: best.score, trackingConfidence: best.score, lostFrames: 0, targetLost: false };
    return this.target;
  }
  age(now = performance.now()) {
    if(this.profileTracking && this.target && !this.target.targetLost && (this.lostSince!==null || now-this.lastSeen>=this.lossTimeoutMs)) {
      this.lostSince ??= this.lastSeen;
      const expired=now-this.lostSince>=REACQUISITION.windowMs;
      this.target={...this.target,state:expired?'LOST':'REACQUIRING',targetLost:expired,trackingConfidence:0};
      return this.target;
    }
    if (this.target && now - this.lastSeen >= this.lossTimeoutMs)
      this.target = { ...this.target, state: 'LOST', targetLost: true, trackingConfidence: 0 };
    else if (this.target?.state === 'TRACKING' && now - this.lastSeen > 300)
      this.target = { ...this.target, state: 'TEMPORARILY_LOST' };
    return this.target;
  }
}
