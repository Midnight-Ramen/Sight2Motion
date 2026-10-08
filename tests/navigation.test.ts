import { EncoderRecording } from '../src/core/EncoderRecording';
import { afterEach, expect, it, vi } from 'vitest';
import { FinchNavigation, NAVIGATION, inverseSegment } from '../src/core/FinchNavigation';
import * as geometry from '../src/core/FinchGeometry';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import type { SensorState } from '../src/core/Sensors';
async function setup(){
 vi.useFakeTimers();let now=0,enabled=true;let state:SensorState={};
 const robot=new MockRobotAdapter();await robot.connect();const wheel=vi.fn(async(_left:number,_right:number,_duration:number,_signal:AbortSignal,_mode?:string)=>{});
 const adapter=Object.assign(robot,{setWheelSpeeds:wheel,connected:true});const engine=new ActionEngine(adapter), status=vi.fn();
 const nav=new FinchNavigation(engine,adapter,()=>state,()=>enabled,status,()=>now);
 const sample=(left=0,right=0)=>{state={finchDistance:{reading:{kind:'number',value:100},updatedAt:now},finchEncoderLeft:{reading:{kind:'number',value:left},updatedAt:now},finchEncoderRight:{reading:{kind:'number',value:right},updatedAt:now}};};
 const distance=(value:number|null,age=0)=>{state.finchDistance={reading:value===null?null:{kind:'number',value},updatedAt:now-age};};
 sample();return {distance,nav,engine,robot:adapter,wheel,status,sample,disable:()=>{enabled=false;},advance:async(ms:number,left?:number,right?:number)=>{now+=ms;if(left!==undefined)sample(left,right);await vi.advanceTimersByTimeAsync(ms);}};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('uses supplied geometry and a turn-only calibration multiplier',()=>{
 expect(geometry.FINCH_WHEEL_DIAMETER_CM).toBe(5);
 expect(geometry.FINCH_EFFECTIVE_TRACK_WIDTH_CM).toBe(10.1);
 expect(geometry.FINCH_TURN_CALIBRATION).toBe(1);
 expect(geometry.distanceRotations(Math.PI*5)).toBeCloseTo(1);
 expect(geometry.turnRotations(90)).toBeCloseTo(.505);
 expect(geometry.turnRotations(-90)).toBeCloseTo(.505);
 expect(()=>geometry.turnRotations(90,null)).toThrow('calibration');
});
it.each(['forward','backward'] as const)('drives %s to target then STOP releases ownership',async direction=>{
 const s=await setup(),sign=direction==='forward'?1:-1;await s.nav.start({kind:'distance',direction,amount:30},30);
 expect(s.wheel.mock.calls[0].slice(0,2)).toEqual([30*sign,30*sign]);
 await s.advance(100,geometry.distanceRotations(30)*sign,geometry.distanceRotations(30)*sign);
 expect(s.nav.active).toBe(false);expect(s.engine.activeMotorOwnerRuleId).toBeNull();expect(s.status).toHaveBeenLastCalledWith('Navigation complete');
});
it('corrects drift and slows near the target',async()=>{
 const s=await setup();await s.nav.start({kind:'distance',direction:'forward',amount:30},30);await s.advance(100,.2,.1);
 const drift=s.wheel.mock.calls.at(-1)!;expect(drift[0]).toBeLessThan(drift[1]);await s.advance(100,1.8,1.8);expect(s.wheel.mock.calls.at(-1)![0]).toBeLessThan(30);s.nav.cancel();
});
it.each([
 ['left',90],['left',180],['left',360],
 ['right',90],['right',180],['right',360],
] as const)('turns %s %s degrees with opposite wheels, slowdown and completion STOP',async(direction,angle)=>{
 const s=await setup(),sign=direction==='left'?-1:1;
 const stop=vi.spyOn(s.robot,'stop');
 expect(await s.nav.start({kind:'turn',direction,amount:angle},30)).toBe(true);
 expect(Math.sign(s.wheel.mock.calls[0][0])).toBe(sign);
 expect(Math.sign(s.wheel.mock.calls[0][1])).toBe(-sign);
 const target=10.1*angle/(360*5);
 await s.advance(100,(target-.1)*sign,-(target-.1)*sign);
 expect(Math.abs(s.wheel.mock.calls.at(-1)![0])).toBeLessThan(30);
 const calls=stop.mock.calls.length;
 await s.advance(100,target*sign,-target*sign);
 expect(s.nav.active).toBe(false);expect(stop.mock.calls.length).toBeGreaterThan(calls);
 expect(s.engine.activeMotorOwnerRuleId).toBeNull();
 expect(s.status).toHaveBeenLastCalledWith('Navigation complete');
});
it.each(['distance','turn'] as const)('%s rejects concurrency and stops on stale data, stall, disabled state and timeout',async kind=>{
 for(const reason of ['stale','stall','disabled','timeout','disconnect','cancel']){
 const s=await setup();await s.nav.start(kind==='distance'?{kind,direction:'forward',amount:200}:{kind,direction:'right',amount:360},30);
 expect(await s.nav.start({kind:'distance',direction:'forward',amount:30},30)).toBe(false);
 if(reason==='disabled')s.disable();
 if(reason==='disconnect')s.robot.connected=false;
 if(reason==='cancel')s.nav.cancel();
 await s.advance(reason==='timeout'?NAVIGATION.timeoutMs:reason==='stall'?NAVIGATION.stallMs:800,...(reason==='stale'?[]:[0,0]) as [number?,number?]);
 expect(s.nav.active).toBe(false);expect(s.engine.activeMotorOwnerRuleId).toBeNull();
 }
});
it('cancel aborts pending acquisition without movement',async()=>{
 const s=await setup();const starting=s.nav.start({kind:'distance',direction:'forward',amount:30},30);s.nav.cancel();await starting;
 expect(s.wheel).not.toHaveBeenCalled();expect(s.nav.active).toBe(false);
});
it('stops a single stalled wheel even if the other keeps advancing',async()=>{
 const s=await setup();await s.nav.start({kind:'distance',direction:'forward',amount:200},30);
 await s.advance(1000,.1,0);await s.advance(500,.2,0);
 expect(s.status).toHaveBeenLastCalledWith('Navigation stopped: encoder progress stalled');
});
it.each(['forward','backward'] as const)('strengthens live drift correction for %s without fixed bias',async direction=>{
 const s=await setup(),sign=direction==='forward'?1:-1;
 await s.nav.start({kind:'distance',direction,amount:100},30);
 await s.advance(100,1.06*sign,1*sign);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([28*sign,30*sign]);
 await s.advance(100,1.1*sign,1.16*sign);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([30*sign,28*sign]);
 await s.advance(100,1.2*sign,1.2*sign);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([30*sign,30*sign]);s.nav.cancel();
});
it('bounds correction, ignores sub-command jitter and retains the slowdown curve',async()=>{
 const s=await setup();await s.nav.start({kind:'distance',direction:'forward',amount:100},30);
 await s.advance(100,.5,0);expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([25,30]);
 await s.advance(100,.601,.6);expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([30,30]);
 const count=s.wheel.mock.calls.length;await s.advance(100,.7,.701);expect(s.wheel.mock.calls.length).toBe(count);
 const target=geometry.distanceRotations(100);
 await s.advance(100,target-.2,target-.26);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([14,17]);s.nav.cancel();
});
it('preserves the original turn correction gain',async()=>{
 vi.spyOn(geometry,'turnRotations').mockReturnValue(2);
 const s=await setup();await s.nav.start({kind:'turn',direction:'right',amount:90},30);
 await s.advance(100,1.06,-1);expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([29,-30]);s.nav.cancel();
});

it('distinct turn targets and consecutive 180 left / 360 right use fresh origins and targets',async()=>{
 expect([90,180,360].map(a=>geometry.turnRotations(a))).toEqual([.505,1.01,2.02].map(x=>expect.closeTo(x,8)));
 const s=await setup(),leftTarget=geometry.turnRotations(180),rightTarget=geometry.turnRotations(360);
 await s.nav.start({kind:'turn',direction:'left',amount:180},30);
 await s.advance(100,-leftTarget,leftTarget);
 expect(s.nav.active).toBe(false);
 expect(await s.nav.start({kind:'turn',direction:'right',amount:360},30)).toBe(true);
 expect(s.status).toHaveBeenLastCalledWith('Turning right 360°…');
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([30,-30]);
 await s.advance(100,0,0); // A prior 180-degree target must not complete a 360 turn.
 expect(s.nav.active).toBe(true);
 await s.advance(100,-leftTarget+rightTarget,leftTarget-rightTarget);
 expect(s.nav.active).toBe(false);
 expect(s.status).toHaveBeenLastCalledWith('Navigation complete');
});

it.each(['left','right'] as const)('progressively brakes %s turns earlier down to 5 percent without reversal',async direction=>{
 const s=await setup(),sign=direction==='left'?-1:1,target=geometry.turnRotations(360);
 await s.nav.start({kind:'turn',direction,amount:360},30);
 const speeds:number[]=[];
 for(const remaining of [.8,.5,.25,.05]){
  await s.advance(100,(target-remaining)*sign,-(target-remaining)*sign);
  const [l,r]=s.wheel.mock.calls.at(-1)!;
  expect(Math.sign(l)).toBe(sign);expect(Math.sign(r)).toBe(-sign);
  speeds.push(Math.abs(l));
 }
 expect(speeds).toEqual([26,14,6,5]);
 const stop=vi.spyOn(s.robot,'stop');
 await s.advance(100,target*sign,-target*sign);
 expect(stop).toHaveBeenCalled();expect(s.nav.active).toBe(false);
});

function recordedPath(deltas:[number,number][]) {
 const r=new EncoderRecording();let pair={left:0,right:0};r.setHome(pair);
 for(const [left,right] of deltas) {
  r.begin('forward',pair);pair={left:pair.left+left,right:pair.right+right};r.stop(pair);
 }
 return {r,pair};
}
it.each(['cancel','stale','stall','timeout','disconnect','disabled'] as const)('return %s abort stops and invalidates Home and route',async reason=>{
 const s=await setup(),{r}=recordedPath([[2,2]]);s.sample(2,2);
 await s.nav.returnToBase(r,30);const stop=vi.spyOn(s.robot,'stop');
 if(reason==='cancel')s.nav.cancel();
 if(reason==='disconnect')s.robot.connected=false;
 if(reason==='disabled')s.disable();
 await s.advance(reason==='timeout'?NAVIGATION.timeoutMs:reason==='stall'?NAVIGATION.stallMs:800,
  ...(reason==='stale'?[]:[2,2]) as [number?,number?]);
 expect(stop).toHaveBeenCalled();expect(s.nav.active).toBe(false);
 expect(r.origin).toBeNull();expect(r.segments).toEqual([]);
 expect(await s.nav.returnToBase(r,30)).toBe(false);
});
it('return cancellation during ownership acquisition prevents motion and invalidates route',async()=>{
 const s=await setup(),{r}=recordedPath([[1,1]]);s.sample(1,1);
 const pending=s.nav.returnToBase(r,30);s.nav.cancel();await pending;
 expect(s.wheel).not.toHaveBeenCalled();expect(r.origin).toBeNull();
});
it('return rejects missing Home/path, stale encoders and concurrent navigation',async()=>{
 const s=await setup(),{r}=recordedPath([[1,1]]);
 expect(await s.nav.returnToBase(new EncoderRecording(),30)).toBe(false);
 await s.advance(800);expect(await s.nav.returnToBase(r,30)).toBe(false);
 s.sample();await s.nav.start({kind:'distance',direction:'forward',amount:30},30);
 expect(await s.nav.returnToBase(r,30)).toBe(false);s.nav.cancel();
});


it.each([
 [2,2,'forward','distance','backward',Math.PI*10],
 [-2,-2,'backward','distance','forward',Math.PI*10],
 [.7,-.5,'right','turn','left',1.2*Math.PI*5/10.1*180/Math.PI],
 [-.4,.6,'left','turn','right',Math.PI*5/10.1*180/Math.PI],
] as const)('derives measured inverse command from %s/%s %s', (left,right,direction,kind,inverse,amount)=>{
 const segment={direction,start:{left:0,right:0},end:{left,right},delta:{left,right}};
 const command=inverseSegment(segment);
 expect(command.kind).toBe(kind);expect(command.direction).toBe(inverse);expect(command.amount).toBeCloseTo(amount);
});
it('replays reverse order through distance/turn tuning without re-recording',async()=>{
 const s=await setup(),{r,pair}=recordedPath([[1,1],[.5,-.5],[2,2]]);
 r.segments[1].direction='right';
 s.sample(pair.left,pair.right);const saved=JSON.stringify(r.segments);
 await s.nav.returnToBase(r,30);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([-30,-30]);
 await s.advance(100,1.5,.5);
 expect(s.status).toHaveBeenLastCalledWith('Returning to Base · 2/3');
 await s.advance(100,1.5,.5);
 // Existing turn braking starts below full speed for a half-rotation turn.
 const turn=s.wheel.mock.calls.at(-1)!;expect(turn[0]).toBeLessThan(0);expect(turn[1]).toBeGreaterThan(0);
 expect(Math.abs(turn[0])).toBeLessThan(30);
 await s.advance(100,1,1);r.observe({left:1,right:1});
 expect(JSON.stringify(r.segments)).toBe(saved);
 await s.advance(100,1,1);expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([-30,-30]);
 await s.advance(100,0,0);
 expect(s.status).toHaveBeenLastCalledWith('At Home');expect(r.segments).toEqual([]);
 expect(r.origin).not.toBeNull();expect(s.engine.activeMotorOwnerRuleId).toBeNull();
});
it('unequal straight travel becomes average distance, not unequal raw wheel targets',async()=>{
 const s=await setup(),{r}=recordedPath([[4,2]]);s.sample(4,2);
 await s.nav.returnToBase(r,30);expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([-30,-30]);
 await s.advance(100,3.9,1.96);
 // Same straight-line gain as Drive Distance.
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([-28,-30]);
 await s.advance(100,1,-1);
 expect(s.nav.active).toBe(false);expect(s.status).toHaveBeenLastCalledWith('Return incomplete');
 expect(r.origin).toBeNull();
 const count=s.wheel.mock.calls.length;await s.advance(100,0,0);expect(s.wheel.mock.calls.length).toBe(count);
});
it('final residual check accepts small error without commanding a correction',async()=>{
 const s=await setup(),{r}=recordedPath([[1,1]]);s.sample(1.01,.99);
 await s.nav.returnToBase(r,30);await s.advance(100,.01,-.01);
 expect(s.status).toHaveBeenLastCalledWith('At Home');expect(s.nav.active).toBe(false);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]);
});

it.each([
 ['lessThan',21,19],['lessThanOrEqual',21,20],
 ['greaterThan',19,21],['greaterThanOrEqual',19,20],
] as const)('Drive Until %s stops on the existing sensor comparator',async(operator,before,after)=>{
 const s=await setup();s.distance(before);
 expect(await s.nav.driveUntil({operator,value:20},30)).toBe(true);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([30,30]);
 s.distance(after);s.nav.sensorsUpdated();
 expect(s.nav.active).toBe(false);expect(s.status).toHaveBeenLastCalledWith('Drive Until complete');
 expect(s.engine.activeMotorOwnerRuleId).toBeNull();
});
it('already satisfied Drive Until condition never sends nonzero movement',async()=>{
 const s=await setup();s.distance(10);await s.nav.driveUntil({operator:'lessThan',value:20},30);
 expect(s.wheel).not.toHaveBeenCalled();expect(s.nav.active).toBe(false);
});
it('emergency braking overrides Drive Distance completion and Drive Until condition',async()=>{
 for(const until of [false,true]){
  const s=await setup();s.distance(100);
  if(until)await s.nav.driveUntil({operator:'lessThan',value:20},30,10);
  else await s.nav.start({kind:'distance',direction:'forward',amount:30},30,10);
  s.sample(2,2);s.distance(10);s.nav.sensorsUpdated();
  expect(s.nav.active).toBe(false);expect(s.status).toHaveBeenLastCalledWith('Emergency braking: obstacle distance');
 }
});
it('stale distance blocks start and aborts monitored forward movement',async()=>{
 const s=await setup();s.distance(100,751);
 expect(await s.nav.driveUntil({operator:'lessThan',value:20},30)).toBe(false);
 expect(await s.nav.start({kind:'distance',direction:'forward',amount:30},30,10)).toBe(false);
 s.distance(100);await s.nav.start({kind:'distance',direction:'forward',amount:30},30,10);
 s.distance(null);s.nav.sensorsUpdated();expect(s.nav.active).toBe(false);
 expect(s.status).toHaveBeenLastCalledWith('Navigation stopped: distance data unavailable');
});
it.each(['cancel','disconnect','disabled','stale encoder','stall','timeout'])('Drive Until aborts on %s',async reason=>{
 const s=await setup();await s.nav.driveUntil({operator:'lessThan',value:20},30);
 const stop=vi.spyOn(s.robot,'stop');
 if(reason==='cancel')s.nav.cancel();
 if(reason==='disconnect')s.robot.connected=false;
 if(reason==='disabled')s.disable();
 await s.advance(reason==='timeout'?NAVIGATION.timeoutMs:reason==='stall'?NAVIGATION.stallMs:800,
  ...(reason==='stale encoder'?[]:[0,0]) as [number?,number?]);
 expect(stop).toHaveBeenCalled();expect(s.nav.active).toBe(false);
});
it('optional braking does not affect backward movement, turns, or unmonitored distance',async()=>{
 for(const command of [
  {kind:'distance',direction:'backward',amount:30},
  {kind:'turn',direction:'left',amount:90},
  {kind:'distance',direction:'forward',amount:30},
 ] as const){
  const s=await setup();s.distance(null);
  expect(await s.nav.start(command,30,command.direction==='forward'?undefined:10)).toBe(true);
  s.nav.cancel();
 }
});

it.each([[50,30],[5,-30],[25,0],[22,0],[28,0]])('Keep Distance reading %s commands %s while retaining ownership',async(distance,wheel)=>{
 const s=await setup();s.distance(distance);
 expect(await s.nav.keepDistance(25,3,30)).toBe(true);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([wheel,wheel]);
 expect(s.nav.active).toBe(true);expect(s.engine.activeMotorOwnerRuleId).not.toBeNull();s.nav.cancel();
});
it('Keep Distance slows proportionally and hysteresis suppresses boundary chatter',async()=>{
 const s=await setup();s.distance(45);await s.nav.keepDistance(25,3,30);
 for(const [distance,wheel] of [[33,10],[29,5],[28,0],[28.4,0],[28.6,5],[25,0],[21.6,0],[21,-5]]){
  s.distance(distance);s.nav.sensorsUpdated();await Promise.resolve();
  expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([wheel,wheel]);
 }
 s.nav.cancel();
});
it('Keep Distance stops before reversing on a large distance jump',async()=>{
 const s=await setup();s.distance(45);await s.nav.keepDistance(25,3,30);
 s.distance(5);s.nav.sensorsUpdated();await Promise.resolve();
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]);
 s.nav.sensorsUpdated();await Promise.resolve();
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([-30,-30]);s.nav.cancel();
});
it('Keep Distance rejects stale data and concurrent autonomous commands',async()=>{
 const s=await setup();s.distance(null);expect(await s.nav.keepDistance(25,3,30)).toBe(false);
 s.distance(25);await s.nav.keepDistance(25,3,30);
 expect(await s.nav.start({kind:'distance',direction:'forward',amount:30},30)).toBe(false);
 expect(await s.nav.driveUntil({operator:'lessThan',value:20},30)).toBe(false);
 expect(await s.nav.keepDistance(25,3,30)).toBe(false);s.nav.cancel();
});
it.each(['stale distance','stale encoder','cancel','disconnect','disabled','stall','timeout'])('Keep Distance stops on %s',async reason=>{
 const s=await setup();await s.nav.keepDistance(25,3,30);const stop=vi.spyOn(s.robot,'stop');
 if(reason==='cancel')s.nav.cancel();
 if(reason==='disconnect')s.robot.connected=false;
 if(reason==='disabled')s.disable();
 if(reason==='stale distance'){s.distance(null);s.nav.sensorsUpdated();}
 await s.advance(reason==='timeout'?NAVIGATION.timeoutMs:reason==='stall'?NAVIGATION.stallMs:800,
  ...(reason==='stale encoder'?[]:[0,0]) as [number?,number?]);
 expect(stop).toHaveBeenCalled();expect(s.nav.active).toBe(false);expect(s.engine.activeMotorOwnerRuleId).toBeNull();
});
it('Keep Distance holds within tolerance without a false stall or movement timeout',async()=>{
 const s=await setup();s.distance(25);await s.nav.keepDistance(25,3,30);
 // Advance clock with fresh encoders and distance held in the stop band.
 for(let i=0;i<80;i++){s.sample();s.distance(25);await s.advance(500);}
 expect(s.nav.active).toBe(true);
 expect(s.wheel.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]);s.nav.cancel();
});
