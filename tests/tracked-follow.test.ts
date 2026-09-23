import { afterEach, expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/core/ActionEngine';
import { FollowController, TRACKED_FOLLOW_DEFAULTS as settings, trackedFollowCommand } from '../src/core/FollowController';
import { TargetTracker, type TrackedTarget } from '../src/core/TargetTracker';
import { orientDetections } from '../src/core/CameraOrientation';
import { makeAction, makeRule, type Detection } from '../src/core/types';
import { MockRobotAdapter } from './MockRobotAdapter';
const target = (error=0, area=0.04): TrackedTarget => ({ active:true,state:'TRACKING',label:'person',
  centerX:320*(1+error),centerY:240,boundingBox:{x:0,y:0,width:100,height:100},
  relativeX:(1+error)/2,relativeY:0.5,normalizedWidth:Math.sqrt(area),normalizedHeight:Math.sqrt(area),
  normalizedArea:area,size:area,errorX:error*320,horizontalError:error,confidence:0.9,trackingConfidence:0.9,lostFrames:0,targetLost:false });
class Wheels extends MockRobotAdapter {
  get connected() { return this.state.connected; }
  setWheelSpeeds=vi.fn(async(left:number,right:number,_duration:number,signal:AbortSignal)=>{
    if (!signal.aborted) { this.state.left=left; this.state.right=right; }
  });
}
afterEach(()=>vi.useRealTimers());
it('brakes on approach to center at slow camera cadence without reversing the correction',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined);
  const c=new FollowController(makeAction('move'),send,vi.fn(),vi.fn());
  await c.updateTracked(target(-0.6),performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(370);
  await c.updateTracked(target(-0.25),performance.now(),1000,settings);
  const [left,right]=send.mock.calls.at(-1)!;
  expect(left).toBe(right); // Closing fast: brake before crossing the center.
  await vi.advanceTimersByTimeAsync(370);
  await c.updateTracked(target(0.02),performance.now(),1000,settings);
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([30,30]); c.cancel();
});
it('holds the center through small edge jitter, then releases for a clear departure',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined);
  const c=new FollowController(makeAction('move'),send,vi.fn(),vi.fn());
  for(const error of [0,0.11,-0.12,0.12]) {
    await c.updateTracked(target(error),performance.now(),1000,settings);
    expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([30,30]);
    await vi.advanceTimersByTimeAsync(370);
  }
  await c.updateTracked(target(0.3),performance.now(),1000,settings);
  const [left,right]=send.mock.calls.at(-1)!; expect(left).toBeGreaterThan(right); c.cancel();
});
it('expires a stale turn before target-loss timeout and duplicate samples cannot extend it',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined),lost=vi.fn();
  const c=new FollowController(makeAction('move'),send,lost,vi.fn());
  const at=performance.now(); await c.updateTracked(target(-0.5,0.15),at,1000,settings);
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([0,10]);
  await vi.advanceTimersByTimeAsync(200); await c.updateTracked(target(-0.5,0.15),at,1000,settings);
  await vi.advanceTimersByTimeAsync(50);
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]); expect(lost).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(750); expect(lost).toHaveBeenCalledOnce();
});
it('delivers the newest braking command after an in-flight write rather than dropping it',async()=>{
  vi.useFakeTimers(); let release!:()=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{release=r;})).mockResolvedValue(undefined);
  const c=new FollowController(makeAction('move'),send,vi.fn(),vi.fn());
  const pending=c.updateTracked(target(-0.5,0.15),performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(100);
  await c.updateTracked(target(0,0.15),performance.now(),1000,settings);
  release(); await pending;
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]); c.cancel();
});
it('cancellation discards queued commands and the steering timer',async()=>{
  vi.useFakeTimers(); let release!:()=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
  const c=new FollowController(makeAction('move'),send,vi.fn(),vi.fn());
  const pending=c.updateTracked(target(-0.5),performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(100);
  await c.updateTracked(target(0.5),performance.now(),1000,settings);
  c.cancel(); release(); await pending; await vi.advanceTimersByTimeAsync(1500);
  expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][2].aborted).toBe(true);
});
it('does not abruptly change wheel speed when entering the outer steering range',()=>{
  const inside=trackedFollowCommand(target(0.65),settings),outside=trackedFollowCommand(target(0.651),settings);
  expect(Math.abs(inside.left-outside.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(inside.right-outside.right)).toBeLessThanOrEqual(1);
});
it('drives equally inside the dead zone, curves progressively, and only stops the inside wheel at extreme errors',()=>{
  for(const error of [-0.1,0,0.1]) expect(trackedFollowCommand(target(error),settings)).toMatchObject({left:30,right:30});
  const slight=trackedFollowCommand(target(-0.2),settings), moderate=trackedFollowCommand(target(-0.5),settings);
  expect(slight.left).toBeGreaterThan(moderate.left); expect(moderate.left).toBeGreaterThan(0);
  expect(moderate.right).toBeGreaterThan(moderate.left);
  const right=trackedFollowCommand(target(0.5),settings); expect([right.left,right.right]).toEqual([moderate.right,moderate.left]);
  expect(trackedFollowCommand(target(-0.8),settings).left).toBeLessThan(moderate.left);
  expect(trackedFollowCommand(target(-1),settings)).toMatchObject({left:0});
  for(const error of [-1,-0.5,0,0.5,1]) {
    const c=trackedFollowCommand(target(error),settings); expect(c.left).toBeGreaterThanOrEqual(0); expect(c.right).toBeLessThanOrEqual(50);
  }
});
it('stops centered at distance, makes small off-center corrections, and stops both wheels when too close',()=>{
  expect(trackedFollowCommand(target(0,0.15),settings)).toMatchObject({left:0,right:0});
  expect(trackedFollowCommand(target(-0.5,0.15),settings)).toMatchObject({left:0,right:10});
  expect(trackedFollowCommand(target(-0.9,0.23),settings)).toMatchObject({left:0,right:0});
  expect(trackedFollowCommand(target(0.5),{...settings,maxSpeed:0})).toMatchObject({left:0,right:0});
});
it('uses mirrored tracker error once and keeps the selected person rather than a higher-confidence other person',()=>{
  const d:Detection={className:'person',confidence:0.75,x:100,y:100,width:100,height:200,centerX:150,centerY:200};
  const other={...d,x:400,centerX:450,confidence:0.99};
  const tracker=new TargetTracker();
  const locked=tracker.initialize({width:640,height:480,mask:new Uint8Array(),boundingBox:{x:100,y:100,width:100,height:200},centroid:{x:150,y:200},area:20000},orientDetections([d,other],640,true),true)!;
  const c=trackedFollowCommand(locked,settings); expect(c.error).toBeGreaterThan(0); expect(c.left).toBeGreaterThan(c.right);
});
it('does not renew the watchdog for duplicate samples, temporary loss, or unreliable confidence',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined), lost=vi.fn();
  const c=new FollowController(makeAction('move'),send,lost,vi.fn());
  await c.updateTracked(target(),performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(370);
  await c.updateTracked(target(),0,1000,settings); expect(send).toHaveBeenCalledOnce();
  await c.updateTracked({...target(),state:'TEMPORARILY_LOST'},performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(370);
  await c.updateTracked({...target(),trackingConfidence:0.1},performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(260); expect(lost).toHaveBeenCalledOnce();
});
it('holds safe commands at 2.7 FPS without resending and stops on explicit target loss',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  await engine.startSelectedFollow(target(),performance.now(),1000,settings);
  for(let i=0;i<4;i++) { await vi.advanceTimersByTimeAsync(370); await engine.updateSelectedTarget(target(),performance.now(),1000,settings); }
  expect(robot.setWheelSpeeds).toHaveBeenCalledOnce(); expect(robot.state.left).toBe(30);
  await engine.updateSelectedTarget({...target(),targetLost:true,state:'LOST'},performance.now(),1000,settings);
  expect(robot.state.left).toBe(0); expect(engine.followingSelectedTarget).toBe(false);
  await engine.updateSelectedTarget(target(),performance.now(),1000,settings); expect(robot.state.left).toBe(0);
});
it('stops when inference stalls and does not restart after global STOP',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  await engine.startSelectedFollow(target(-0.5),performance.now(),1000,settings);
  await vi.advanceTimersByTimeAsync(1000); expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
  await engine.startSelectedFollow(target(),performance.now(),1000,settings); await engine.stop();
  const count=robot.setWheelSpeeds.mock.calls.length;
  await engine.updateSelectedTarget(target(),performance.now(),1000,settings); await vi.advanceTimersByTimeAsync(2000);
  expect(robot.setWheelSpeeds).toHaveBeenCalledTimes(count); expect(robot.state.left).toBe(0);
});
it('global STOP cancels a pending start before wheel commands',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  let release!:()=>void;
  vi.spyOn(robot,'stop').mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
  const start=engine.startSelectedFollow(target(),performance.now(),1000,settings);
  await engine.stop(); release(); await start;
  expect(robot.setWheelSpeeds).not.toHaveBeenCalled(); expect(engine.followingSelectedTarget).toBe(false);
});
it('class-based rules take ownership and selected tracker updates cannot overwrite them',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  await engine.startSelectedFollow(target(),performance.now(),1000,settings);
  const r={...makeRule(),actions:[{...makeAction('move'),mode:'continuous' as const,speed:20}]};
  await engine.updateRules([r],[r]); expect(engine.followingSelectedTarget).toBe(false);
  await engine.updateSelectedTarget(target(-1),performance.now(),1000,settings);
  expect(robot.state.left).toBe(20); expect(robot.state.right).toBe(20); await engine.stop();
});
it('rejects stale initial samples without issuing movement',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  await engine.startSelectedFollow(target(),performance.now()-3000,1000,settings);
  expect(robot.setWheelSpeeds).not.toHaveBeenCalled(); expect(engine.followingSelectedTarget).toBe(false);
});
