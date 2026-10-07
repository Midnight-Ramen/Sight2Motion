import { afterEach, expect, it, vi } from 'vitest';
import { FinchNavigation, NAVIGATION } from '../src/core/FinchNavigation';
import * as geometry from '../src/core/FinchGeometry';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import type { SensorState } from '../src/core/Sensors';
async function setup(){
 vi.useFakeTimers();let now=0,enabled=true;let state:SensorState={};
 const robot=new MockRobotAdapter();await robot.connect();const wheel=vi.fn(async(_left:number,_right:number,_duration:number,_signal:AbortSignal,_mode?:string)=>{});
 const adapter=Object.assign(robot,{setWheelSpeeds:wheel,connected:true});const engine=new ActionEngine(adapter), status=vi.fn();
 const nav=new FinchNavigation(engine,adapter,()=>state,()=>enabled,status,()=>now);
 const sample=(left=0,right=0)=>{state={finchEncoderLeft:{reading:{kind:'number',value:left},updatedAt:now},finchEncoderRight:{reading:{kind:'number',value:right},updatedAt:now}};};
 sample();return {nav,engine,robot:adapter,wheel,status,sample,disable:()=>{enabled=false;},advance:async(ms:number,left?:number,right?:number)=>{now+=ms;if(left!==undefined)sample(left,right);await vi.advanceTimersByTimeAsync(ms);}};
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
