import { EncoderRecording, encoderPair, type RecordedSegment } from './EncoderRecording';
import { distanceRotations, turnRotations, FINCH_WHEEL_CIRCUMFERENCE_CM, FINCH_EFFECTIVE_TRACK_WIDTH_CM } from './FinchGeometry';
import { makeRule, makeAction } from './types';
import type { ActionEngine } from './ActionEngine';
import type { RobotAdapter } from './RobotAdapter';
import { SENSOR_MAX_AGE, sensorMatches, type SensorState, type SensorCondition } from './Sensors';

export const NAVIGATION = { tickMs: 100, timeoutMs: 30000, stallMs: 1500, progressRotations: .01,
 toleranceRotations: .02, slowdownRotations: .5, minimumSpeed: 10, turnSlowdownRotations: .9, turnMinimumSpeed: 5, turnSlowdownExponent: 1.3, driftGain: 20, straightDriftGain: 30, maxCorrection: 5, homeToleranceRotations: .02 } as const;
export const KEEP_DISTANCE = { hysteresisCm: .5, speedPerCm: 2, minimumSpeed: 5 } as const;
type KeepDistanceState={target:number;tolerance:number;direction:number|null;motionSince:number};
export const LINE_THRESHOLD=91;
// Marker actions share the paired Line Follow ownership and control path.
export const LINE_INTERSECTIONS_ENABLED=true;
export function lineDirection(left:number,right:number) {
 return left>LINE_THRESHOLD&&right<LINE_THRESHOLD?'RIGHT':left<LINE_THRESHOLD&&right>LINE_THRESHOLD?'LEFT':'STRAIGHT';
}
export type LineEventMode = 'stop' | 'continue' | 'left' | 'right';
export const FINCH_INTERSECTION_TURN_DEG=85;
export const LINE_EVENT={debounceMs:100,crossingTimeoutMs:3000,crossingSpeed:.5,settleBeforeMs:150,settleAfterMs:100,turnSpeed:12} as const;
type LineState={pairDriven:boolean;pairStamp:string;pauseUntil:number|null;afterTurn:boolean;followSpeed:number;mode:LineEventMode;markerSince:number|null;armed:boolean;crossingSince:number|null;turning:boolean;on:[boolean,boolean];};
export function freshLines(state:SensorState,now:number):[number,number]|null {
 const samples=[state.finchLineLeft,state.finchLineRight];
 if(samples.some(s=>!s||s.reading?.kind!=='number'||!Number.isFinite(s.reading.value)||s.reading.value<0||s.reading.value>100||now<s.updatedAt||now-s.updatedAt>SENSOR_MAX_AGE))return null;
 return samples.map(s=>s.reading!.value) as [number,number];
}
export type NavigationCommand = { kind: 'distance'; direction: 'forward' | 'backward'; amount: number } |
 { kind: 'turn'; direction: 'left' | 'right'; amount: number };
export type DriveUntilCondition={operator:Exclude<SensorCondition['operator'],'equals'>;value:number};
export function freshDistance(state:SensorState,now:number):number|null {
 const sample=state.finchDistance;
 return sample?.reading?.kind==='number' && Number.isFinite(sample.reading.value) && sample.reading.value>=0
  && now>=sample.updatedAt && now-sample.updatedAt<=SENSOR_MAX_AGE ? sample.reading.value : null;
}
type ForwardSafety={until?:DriveUntilCondition;emergencyDistance?:number};
export function inverseSegment(segment: RecordedSegment): NavigationCommand {
 const {left,right}=segment.delta;
 if(!Number.isFinite(left)||!Number.isFinite(right))throw new Error('Invalid recorded travel');
 if(segment.direction==='forward'||segment.direction==='backward') {
  const cm=(left+right)/2*FINCH_WHEEL_CIRCUMFERENCE_CM;
  return {kind:'distance',direction:cm>=0?'backward':'forward',amount:Math.abs(cm)};
 }
 if(!FINCH_EFFECTIVE_TRACK_WIDTH_CM)throw new Error('Turn calibration required');
 const degrees=(left-right)*FINCH_WHEEL_CIRCUMFERENCE_CM/FINCH_EFFECTIVE_TRACK_WIDTH_CM*180/Math.PI;
 return {kind:'turn',direction:degrees>=0?'left':'right',amount:Math.abs(degrees)};
}
function motion(command: NavigationCommand) {
 return {
  target:command.kind==='distance'?distanceRotations(command.amount):turnRotations(command.amount),
  signs:(command.direction==='forward'?[1,1]:command.direction==='backward'?[-1,-1]:command.direction==='left'?[-1,1]:[1,-1]) as [number,number],
  straight:command.kind==='distance',
 };
}
type ReturnRoute={commands:NavigationCommand[];index:number;recording:EncoderRecording};
/** Consumes existing sensor state; never polls sensors or implements transport. */
export class FinchNavigation {
 private job?: { owner: string; abort: AbortController; start: {left:number;right:number}; target:number;
  signs:[number,number]; straight:boolean; speed:number; began:number; progress:[number,number]; advanced:[number,number]; ready:boolean; route?:ReturnRoute; advancing?:boolean; safety?:ForwardSafety; keep?:KeepDistanceState; line?:LineState };
 private timer?: ReturnType<typeof setInterval>;
 private sending = false;
 private lastCommand?: string;
 get lineSensorIds():string[] {
  const line=this.job?.line;if(!line)return [];
  return line.turning||(line.pauseUntil!==null&&!line.afterTurn)
   ? ['finchLineLeft','finchLineRight','finchEncoderLeft','finchEncoderRight']
   : ['finchLineLeft','finchLineRight'];
 }
 get lineActive() { return !!this.job?.line; }
 get active() { return !!this.job; }
 constructor(private engine: ActionEngine, private robot: RobotAdapter, private sensors: () => SensorState,
  private allowed: () => boolean, private status: (message: string) => void, private now = () => performance.now()) {}
 async start(command: NavigationCommand, speed: number, emergencyDistance?:number) {
  if (this.active || !this.allowed() || !this.robot.connected || !this.robot.setWheelSpeeds ||
   !Number.isFinite(speed) || speed <= 0 || speed > 100 || !Number.isFinite(command.amount) || command.amount <= 0 ||
   command.amount > (command.kind === 'distance' ? 200 : 360)) return false;
  const start = encoderPair(this.sensors(), this.now()); if (!start) return false;
  const safety=command.kind==='distance'&&command.direction==='forward'&&emergencyDistance!==undefined ? {emergencyDistance} : undefined;
  if(safety && (!Number.isFinite(emergencyDistance)||safety.emergencyDistance<0||freshDistance(this.sensors(),this.now())===null))return false;
  let plan:ReturnType<typeof motion>;
  try { plan=motion(command); } catch {this.status('Turn calibration required');return false;}
  return this.begin(start,plan.target,plan.signs,plan.straight,speed,
   command.kind === 'distance' ? `Driving ${command.amount} cm…` : `Turning ${command.direction} ${command.amount}°…`,undefined,safety);
 }
 async driveUntil(condition:DriveUntilCondition,speed:number,emergencyDistance?:number) {
  if(this.active||!this.allowed()||!this.robot.connected||!this.robot.setWheelSpeeds||
   !Number.isFinite(speed)||speed<=0||speed>100||!Number.isFinite(condition.value)||condition.value<0||
   !['lessThan','lessThanOrEqual','greaterThan','greaterThanOrEqual'].includes(condition.operator)||
   (emergencyDistance!==undefined&&(!Number.isFinite(emergencyDistance)||emergencyDistance<0)))return false;
  const start=encoderPair(this.sensors(),this.now());
  if(!start||freshDistance(this.sensors(),this.now())===null)return false;
  return this.begin(start,Infinity,[1,1],true,speed,'Driving until distance condition…',undefined,{until:{...condition},emergencyDistance});
 }
 async keepDistance(target:number,tolerance:number,speed:number) {
  if(this.active||!this.allowed()||!this.robot.connected||!this.robot.setWheelSpeeds||
   !Number.isFinite(target)||target<=0||!Number.isFinite(tolerance)||tolerance<0||tolerance>=target||
   !Number.isFinite(speed)||speed<=0||speed>100)return false;
  const start=encoderPair(this.sensors(),this.now());
  if(!start||freshDistance(this.sensors(),this.now())===null)return false;
  return this.begin(start,Infinity,[1,1],true,speed,'Keep Distance active',undefined,undefined,
   {target,tolerance,direction:null,motionSince:this.now()});
 }
 async lineFollow(speed:number,mode:LineEventMode='stop',pairDriven=false) {
  if(this.active||!this.allowed()||!this.robot.connected||!this.robot.setWheelSpeeds||
   !Number.isFinite(speed)||speed<=0||speed>100)return false;
  const start=encoderPair(this.sensors(),this.now())??{left:0,right:0},lines=freshLines(this.sensors(),this.now());
  if(!lines)return false;
  return this.begin(start,Infinity,[1,1],true,speed,'Line Follow active',undefined,undefined,undefined,
   {pairDriven,pairStamp:'',pauseUntil:null,afterTurn:false,followSpeed:speed,mode,markerSince:null,armed:true,crossingSince:null,turning:false,on:lines.map(v=>v<LINE_THRESHOLD) as [boolean,boolean]});
 }
 // Sensor updates can stop forward navigation immediately without another polling loop.
 async sensorsUpdated(completePair=false) { if(this.job?.safety||this.job?.keep||this.job?.line)await this.tick(completePair); }
 async returnToBase(recording: EncoderRecording, speed: number) {
  if(this.active || !this.allowed() || !this.robot.connected || !this.robot.setWheelSpeeds ||
   !Number.isFinite(speed) || speed<=0 || speed>100 || !recording.origin || !recording.segments.length) return false;
  const start=encoderPair(this.sensors(),this.now());if(!start)return false;
  recording.stop(start);
  let commands:NavigationCommand[];
  try {commands=recording.segments.slice().reverse().map(inverseSegment).filter(c=>c.amount>0);}
  catch {this.status('Return incomplete');return false;}
  if(!commands.length)return false;
  const route={commands,index:0,recording},plan=motion(commands[0]);
  return this.begin(start,plan.target,plan.signs,plan.straight,speed,
   `Returning to Base · 1/${commands.length}`,route);
 }
 private async begin(start:{left:number;right:number},target:number,signs:[number,number],straight:boolean,speed:number,
  message:string,route?:ReturnRoute,safety?:ForwardSafety,keep?:KeepDistanceState,line?:LineState) {
  const began=this.now();
  const job: NonNullable<FinchNavigation['job']> = { owner: `navigation-${crypto.randomUUID()}`, abort: new AbortController(), start,target,signs,straight,speed,
   began,progress:[0,0],advanced:[began,began],ready:false,route,safety,keep,line };
  this.job=job;this.lastCommand=undefined;this.status(message);
  this.timer = setInterval(() => { void this.tick(); }, NAVIGATION.tickMs);
  // Claim the same wheel owner as Manual Drive using a zero-speed continuous action.
  const owner = { ...makeRule(), id: job.owner, actions: [{ ...makeAction('move'), mode: 'continuous' as const, speed: 0 }] };
  try {
   const ok = await this.engine.updateRules([owner],[owner]);
   if (this.job !== job) return false;
   if (!ok) { this.cancel('Navigation could not start'); return false; }
   job.ready = true; await this.tick(); return this.job === job;
  } catch { this.cancel('Navigation command failed'); return false; }
 }
 cancel(message = 'Navigation stopped') {
  this.finish(message,false);
 }
 private finish(message:string,success:boolean) {
  const job = this.job; if (!job) return;
  this.job = undefined; job.abort.abort(); clearInterval(this.timer); this.timer = undefined;
  void this.engine.stop();
  if(job.route) { if(success)job.route.recording.completeReturn();else job.route.recording.clear(); }
  this.status(message);
 }
 private async tick(completePair=false) {
  const j=this.job; if (!j) return;
  const now=this.now(), pair=encoderPair(this.sensors(),now)??(j.line&&!j.line.turning?{left:0,right:0}:null);
  if (!this.allowed() || !this.robot.connected) { this.cancel(); return; }
  if (!pair) { this.cancel('Navigation stopped: encoder data unavailable'); return; }
  if(j.safety) {
   const state=this.sensors(),distance=freshDistance(state,now);
   if(distance===null){this.cancel('Navigation stopped: distance data unavailable');return;}
   if(j.safety.emergencyDistance!==undefined&&distance<=j.safety.emergencyDistance){
    this.cancel('Emergency braking: obstacle distance');return;
   }
   if(j.safety.until&&sensorMatches({id:'drive-until',sensorId:'finchDistance',...j.safety.until},state,now)){
    this.cancel('Drive Until complete');return;
   }
  }
  if (!j.keep && (!j.line||j.line.turning) && now-j.began>=NAVIGATION.timeoutMs) { this.cancel('Navigation stopped: timeout'); return; }
  if (!j.ready || j.advancing) return;
  if (this.engine.activeMotorOwnerRuleId!==j.owner) { this.cancel('Navigation stopped: wheel ownership changed'); return; }
  if(j.line){
   if(!freshLines(this.sensors(),now)){this.cancel('Line Follow stopped: line sensor data unavailable');return;}
   if(!j.line.turning){if(!j.line.pairDriven||completePair)await this.tickLine(j,now);return;}
  }
  if(j.keep){await this.tickKeep(j,pair,now);return;}
  const progress=[(pair.left-j.start.left)*j.signs[0],(pair.right-j.start.right)*j.signs[1]];
  const done=progress.map(p=>p>=j.target-NAVIGATION.toleranceRotations);
  if (done.every(Boolean)) {
   if(j.line?.turning){
    if(this.sending)return;
    await this.sendWheels(j,[0,0]);if(this.job!==j)return;
    j.line.turning=false;j.line.pauseUntil=this.now()+LINE_EVENT.settleAfterMs;j.line.afterTurn=true;j.speed=j.line.followSpeed;
    this.status('FOLLOWING');return;
   }
   if(!j.route) {this.cancel('Navigation complete');return;}
   if(this.sending)return;
   j.advancing=true;
   try {
    await this.robot.setWheelSpeeds!(0,0,0,j.abort.signal,'continuous');
    if(this.job!==j)return;

    const fresh=encoderPair(this.sensors(),this.now());
    if(!fresh||!this.allowed()||!this.robot.connected){this.cancel('Return stopped: encoder data or connection unavailable');return;}
    if(++j.route.index===j.route.commands.length) {
     const home=j.route.recording.origin;
     const atHome=home && Math.abs(home.left-fresh.left)<=NAVIGATION.homeToleranceRotations
      && Math.abs(home.right-fresh.right)<=NAVIGATION.homeToleranceRotations;
     this.finish(atHome?'At Home':'Return incomplete',!!atHome);return;
    }
    const plan=motion(j.route.commands[j.route.index]);
    j.start=fresh;j.target=plan.target;j.signs=plan.signs;j.straight=plan.straight;
    j.progress=[0,0];j.began=this.now();j.advanced=[j.began,j.began];
    this.lastCommand=undefined;this.status(`Returning to Base · ${j.route.index+1}/${j.route.commands.length}`);
   }catch{if(this.job===j)this.cancel('Return command failed');}
   finally{j.advancing=false;}
   return;
  }
  for(let i=0;i<2;i++) {
   if(progress[i]-j.progress[i]>=NAVIGATION.progressRotations) {j.progress[i]=progress[i];j.advanced[i]=now;}
   if(!done[i] && now-j.advanced[i]>=NAVIGATION.stallMs) {this.cancel('Navigation stopped: encoder progress stalled');return;}
  }
  const remaining=j.target-Math.min(...progress);
  const base=j.straight
   ? Math.min(j.speed,Math.max(Math.min(j.speed,NAVIGATION.minimumSpeed),j.speed*Math.min(1,remaining/NAVIGATION.slowdownRotations)))
   : Math.min(j.speed,Math.max(Math.min(j.speed,NAVIGATION.turnMinimumSpeed),j.speed*Math.pow(Math.min(1,remaining/NAVIGATION.turnSlowdownRotations),NAVIGATION.turnSlowdownExponent)));
  const correction=Math.max(-NAVIGATION.maxCorrection,Math.min(NAVIGATION.maxCorrection,(progress[0]-progress[1])*(j.straight ? NAVIGATION.straightDriftGain : NAVIGATION.driftGain)));
  const output=[base-correction,base+correction].map((v,i)=>done[i]?0:Math.round(Math.max(0,Math.min(j.speed,v)))*j.signs[i]);
  await this.sendWheels(j,output);
 }
 private async tickLine(j:NonNullable<FinchNavigation['job']>,now:number) {
  const values=freshLines(this.sensors(),now);
  if(!values){this.cancel('Line Follow stopped: line sensor data unavailable');return;}
  if(LINE_INTERSECTIONS_ENABLED && await this.tickLineMarker(j,now))return;
  const state=this.sensors(),stamp=state.finchLineLeft.updatedAt+':'+state.finchLineRight.updatedAt+':'+values.join(',');
  if(j.line!.pairStamp===stamp)return;
  j.line!.pairStamp=stamp;
  const direction=lineDirection(...values);
  this.status('Line Follow active');
  await this.sendWheels(j,direction==='RIGHT'?[j.speed,0]:direction==='LEFT'?[0,j.speed]:[j.speed,j.speed]);
 }
 private async tickLineMarker(j:NonNullable<FinchNavigation['job']>,now:number) {
  const line=j.line!,state=this.sensors(),values=freshLines(state,now);
  if(!values){this.cancel('Line Follow stopped: line sensor data unavailable');return true;}
  if(line.pauseUntil!==null){
   if(now<line.pauseUntil)return true;
   line.pauseUntil=null;
   if(line.afterTurn){line.afterTurn=false;line.crossingSince=now;}
   else{
    const pair=encoderPair(state,now);
    if(!pair){this.cancel('Navigation stopped: encoder data unavailable');return true;}
    const plan=motion({kind:'turn',direction:line.mode==='left'?'left':'right',amount:FINCH_INTERSECTION_TURN_DEG});
    j.start=pair;j.target=plan.target;j.signs=plan.signs;j.straight=false;j.speed=Math.min(line.followSpeed,LINE_EVENT.turnSpeed);
    j.began=now;j.progress=[0,0];j.advanced=[now,now];line.turning=true;return true;
   }
  }
  line.on=values.map(v=>v<LINE_THRESHOLD) as [boolean,boolean];
  const bothWhite=values.every(v=>v>LINE_THRESHOLD);
  if(bothWhite){line.armed=true;line.markerSince=null;line.crossingSince=null;}
  if(line.crossingSince!==null){
   if(now-line.crossingSince>=LINE_EVENT.crossingTimeoutMs){this.cancel('Line Follow stopped: marker crossing timeout');return true;}
   await this.sendWheels(j,[j.speed*LINE_EVENT.crossingSpeed,j.speed*LINE_EVENT.crossingSpeed]);return true;
  }
  if(line.on.every(Boolean)){
   const sampleAt=Math.min(state.finchLineLeft.updatedAt,state.finchLineRight.updatedAt);
   if(line.markerSince===null)line.markerSince=sampleAt;
   if(line.armed && sampleAt-line.markerSince>=LINE_EVENT.debounceMs){
    if(this.sending)return true;
    line.armed=false;
    if(line.mode==='stop'){this.cancel('STOP LINE');return true;}
    if(line.mode==='continue'){line.crossingSince=now;this.status('FOLLOWING');return true;}
    if(this.sending)return true;
    j.advancing=true;
    try{
     await this.sendWheels(j,[0,0]);if(this.job!==j)return true;
     line.pauseUntil=this.now()+LINE_EVENT.settleBeforeMs;line.afterTurn=false;
     this.status(line.mode==='left'?'INTERSECTION → LEFT':'INTERSECTION → RIGHT');
    }catch{if(this.job===j)this.cancel('Intersection turn failed');}finally{j.advancing=false;}
    return true;
   }
   return false;
  }
  line.markerSince=null;
  return false;
 }
 private async tickKeep(j:NonNullable<FinchNavigation['job']>,pair:{left:number;right:number},now:number) {
  const keep=j.keep!,distance=freshDistance(this.sensors(),now);
  if(distance===null){this.cancel('Keep Distance stopped: distance data unavailable');return;}
  const error=distance-keep.target,sign=Math.sign(error);
  let direction=keep.direction;
  if(Math.abs(error)<=keep.tolerance)direction=0;
  else if(direction===null)direction=sign;
  else if(direction===0){if(Math.abs(error)>keep.tolerance+KEEP_DISTANCE.hysteresisCm)direction=sign;}
  else if(direction!==sign)direction=0; // Stop before changing direction.
  if(direction!==keep.direction||direction===0){
   j.start=pair;j.progress=[0,0];j.advanced=[now,now];keep.motionSince=now;
  }
  keep.direction=direction;
  if(direction!==0){
   if(now-keep.motionSince>=NAVIGATION.timeoutMs){this.cancel('Keep Distance stopped: timeout');return;}
   const progress=[(pair.left-j.start.left)*direction!,(pair.right-j.start.right)*direction!];
   for(let i=0;i<2;i++){
    if(progress[i]-j.progress[i]>=NAVIGATION.progressRotations){j.progress[i]=progress[i];j.advanced[i]=now;}
    if(now-j.advanced[i]>=NAVIGATION.stallMs){this.cancel('Keep Distance stopped: encoder progress stalled');return;}
   }
  }
  const magnitude=Math.min(j.speed,Math.max(KEEP_DISTANCE.minimumSpeed,
   (Math.abs(error)-keep.tolerance)*KEEP_DISTANCE.speedPerCm));
  const wheel=direction===0?0:Math.round(magnitude)*direction!;
  await this.sendWheels(j,[wheel,wheel]);
 }
 private async sendWheels(j:NonNullable<FinchNavigation['job']>,output:number[]) {
  const key=output.join(','); if(this.sending||key===this.lastCommand)return;
  this.sending=true;
  try {
   await this.robot.setWheelSpeeds!(output[0],output[1],0,j.abort.signal,'continuous');
   if(this.job===j)this.lastCommand=key;
  } catch {if(this.job===j)this.cancel('Navigation command failed');}
  finally {this.sending=false;}
 }
}
