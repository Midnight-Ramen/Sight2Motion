import { EncoderRecording, encoderPair, type RecordedSegment } from './EncoderRecording';
import { distanceRotations, turnRotations, FINCH_WHEEL_CIRCUMFERENCE_CM, FINCH_EFFECTIVE_TRACK_WIDTH_CM } from './FinchGeometry';
import { makeRule, makeAction } from './types';
import type { ActionEngine } from './ActionEngine';
import type { RobotAdapter } from './RobotAdapter';
import { SENSOR_MAX_AGE, sensorMatches, type SensorState, type SensorCondition } from './Sensors';

export const NAVIGATION = { tickMs: 100, timeoutMs: 30000, stallMs: 1500, progressRotations: .01,
 toleranceRotations: .02, slowdownRotations: .5, minimumSpeed: 10, turnSlowdownRotations: .9, turnMinimumSpeed: 5, turnSlowdownExponent: 1.3, driftGain: 20, straightDriftGain: 30, maxCorrection: 5, homeToleranceRotations: .02 } as const;
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
  signs:[number,number]; straight:boolean; speed:number; began:number; progress:[number,number]; advanced:[number,number]; ready:boolean; route?:ReturnRoute; advancing?:boolean; safety?:ForwardSafety };
 private timer?: ReturnType<typeof setInterval>;
 private sending = false;
 private lastCommand?: string;
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
 // Sensor updates can stop forward navigation immediately without another polling loop.
 sensorsUpdated() { if(this.job?.safety)void this.tick(); }
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
  message:string,route?:ReturnRoute,safety?:ForwardSafety) {
  const began=this.now();
  const job: NonNullable<FinchNavigation['job']> = { owner: `navigation-${crypto.randomUUID()}`, abort: new AbortController(), start,target,signs,straight,speed,
   began,progress:[0,0],advanced:[began,began],ready:false,route,safety };
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
 private async tick() {
  const j=this.job; if (!j) return;
  const now=this.now(), pair=encoderPair(this.sensors(),now);
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
  if (now-j.began>=NAVIGATION.timeoutMs) { this.cancel('Navigation stopped: timeout'); return; }
  if (!j.ready || j.advancing) return;
  if (this.engine.activeMotorOwnerRuleId!==j.owner) { this.cancel('Navigation stopped: wheel ownership changed'); return; }
  const progress=[(pair.left-j.start.left)*j.signs[0],(pair.right-j.start.right)*j.signs[1]];
  const done=progress.map(p=>p>=j.target-NAVIGATION.toleranceRotations);
  if (done.every(Boolean)) {
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
  const key=output.join(','); if(this.sending||key===this.lastCommand)return;
  this.sending=true;
  try {
   await this.robot.setWheelSpeeds!(output[0],output[1],0,j.abort.signal,'continuous');
   if(this.job===j)this.lastCommand=key;
  } catch {if(this.job===j)this.cancel('Navigation command failed');}
  finally {this.sending=false;}
 }
}
