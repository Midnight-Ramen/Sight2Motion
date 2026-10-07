import { encoderPair } from './EncoderRecording';
import { distanceRotations, turnRotations } from './FinchGeometry';
import { makeRule, makeAction } from './types';
import type { ActionEngine } from './ActionEngine';
import type { RobotAdapter } from './RobotAdapter';
import type { SensorState } from './Sensors';

export const NAVIGATION = { tickMs: 100, timeoutMs: 30000, stallMs: 1500, progressRotations: .01,
 toleranceRotations: .02, slowdownRotations: .5, minimumSpeed: 10, turnSlowdownRotations: .9, turnMinimumSpeed: 5, turnSlowdownExponent: 1.3, driftGain: 20, straightDriftGain: 30, maxCorrection: 5 } as const;
export type NavigationCommand = { kind: 'distance'; direction: 'forward' | 'backward'; amount: number } |
 { kind: 'turn'; direction: 'left' | 'right'; amount: number };
/** Consumes existing sensor state; never polls sensors or implements transport. */
export class FinchNavigation {
 private job?: { owner: string; abort: AbortController; start: {left:number;right:number}; target:number;
  signs:[number,number]; straight:boolean; speed:number; began:number; progress:[number,number]; advanced:[number,number]; ready:boolean };
 private timer?: ReturnType<typeof setInterval>;
 private sending = false;
 private lastCommand?: string;
 get active() { return !!this.job; }
 constructor(private engine: ActionEngine, private robot: RobotAdapter, private sensors: () => SensorState,
  private allowed: () => boolean, private status: (message: string) => void, private now = () => performance.now()) {}
 async start(command: NavigationCommand, speed: number) {
  if (this.active || !this.allowed() || !this.robot.connected || !this.robot.setWheelSpeeds ||
   !Number.isFinite(speed) || speed <= 0 || speed > 100 || !Number.isFinite(command.amount) || command.amount <= 0 ||
   command.amount > (command.kind === 'distance' ? 200 : 360)) return false;
  const start = encoderPair(this.sensors(), this.now()); if (!start) return false;
  let target: number;
  try { target = command.kind === 'distance' ? distanceRotations(command.amount) : turnRotations(command.amount); }
  catch { this.status('Turn calibration required'); return false; }
  const signs: [number,number] = command.direction === 'forward' ? [1,1] : command.direction === 'backward' ? [-1,-1] : command.direction === 'left' ? [-1,1] : [1,-1];
  const began = this.now();
  const job = { owner: `navigation-${crypto.randomUUID()}`, abort: new AbortController(), start, target, signs, straight: command.kind === 'distance', speed,
   began, progress: [0,0] as [number,number], advanced: [began,began] as [number,number], ready: false };
  this.job = job; this.lastCommand = undefined;
  this.status(command.kind === 'distance' ? `Driving ${command.amount} cm…` : `Turning ${command.direction} ${command.amount}°…`);
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
  const job = this.job; if (!job) return;
  this.job = undefined; job.abort.abort(); clearInterval(this.timer); this.timer = undefined;
  void this.engine.stop(); this.status(message);
 }
 private async tick() {
  const j=this.job; if (!j) return;
  const now=this.now(), pair=encoderPair(this.sensors(),now);
  if (!this.allowed() || !this.robot.connected) { this.cancel(); return; }
  if (!pair) { this.cancel('Navigation stopped: encoder data unavailable'); return; }
  if (now-j.began>=NAVIGATION.timeoutMs) { this.cancel('Navigation stopped: timeout'); return; }
  if (!j.ready) return;
  if (this.engine.activeMotorOwnerRuleId!==j.owner) { this.cancel('Navigation stopped: wheel ownership changed'); return; }
  const progress=[(pair.left-j.start.left)*j.signs[0],(pair.right-j.start.right)*j.signs[1]];
  const done=progress.map(p=>p>=j.target-NAVIGATION.toleranceRotations);
  if (done.every(Boolean)) { this.cancel('Navigation complete'); return; }
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
