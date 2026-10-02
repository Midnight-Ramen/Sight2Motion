import { afterEach, expect, it, vi } from 'vitest';
import { FollowController, FOLLOW_LAUNCH, followLaunchRamp, TRACKED_FOLLOW_DEFAULTS } from '../src/core/FollowController';
import { makeAction } from '../src/core/types';
import type { TrackedTarget } from '../src/core/TargetTracker';
const action={...makeAction('move'),mode:'follow' as const,followSpeed:40};
const box=(error:number)=>({x:(1+error)/2-.1,y:.2,width:.2,height:.2});
const tracked=(error:number,confidence=.9):TrackedTarget=>({active:true,state:'TRACKING',label:'person',centerX:320,centerY:240,
  boundingBox:box(error),relativeX:(1+error)/2,relativeY:.5,normalizedWidth:.2,normalizedHeight:.2,normalizedArea:.04,size:.04,
  errorX:error*320,horizontalError:error,confidence,trackingConfidence:confidence,lostFrames:0,targetLost:false});
function setup(){vi.useFakeTimers();const send=vi.fn().mockResolvedValue(undefined),lost=vi.fn();return{send,lost,c:new FollowController(action,send,lost,vi.fn())};}
afterEach(()=>vi.useRealTimers());
async function lock(c:FollowController,errors=[.24,.26,.28,.26]) {
  for(let i=0;i<errors.length;i++){if(i)await vi.advanceTimersByTimeAsync(100);await c.update([box(errors[i])]);}
}
it('initializes steering from recent settling samples and limits the first post-lock jump',async()=>{
  const {c,send}=setup();await lock(c);
  expect(c.commandSnapshot.smoothedError).toBeCloseTo(.26);
  expect(c.commandSnapshot.targetLock).toBe('Soft start');
  expect(send.mock.calls.every(([l,r])=>l===0&&r===0)).toBe(true);
  await vi.advanceTimersByTimeAsync(100);await c.update([box(.5)]);
  expect(c.commandSnapshot.smoothedError).toBeCloseTo(.26+.25*(.5-.26));
  expect(c.commandSnapshot.smoothedError).toBeLessThan(.5);c.cancel();
});
it('ramps steering over 600 ms and forward over 500 ms without extra timers',async()=>{
  const {c,send}=setup();await lock(c,[0,0,0,0]);
  expect(c.commandSnapshot).toMatchObject({steeringRamp:.5,forwardRamp:0});
  const commands:number[]=[];
  for(let i=1;i<=6;i++){
    await vi.advanceTimersByTimeAsync(100);await c.update([box(0)]);
    expect(c.commandSnapshot.steeringRamp).toBeCloseTo(.5+.5*i/6);
    expect(c.commandSnapshot.forwardRamp).toBeCloseTo(Math.min(1,i/5));
    commands.push(send.mock.calls.at(-1)![0]);expect(vi.getTimerCount()).toBe(2);
  }
  expect(c.commandSnapshot.targetLock).toBe('Locked');
  expect(commands[0]).toBeGreaterThan(0);expect(commands[0]).toBeLessThan(commands.at(-1)!);
  for(let i=1;i<commands.length;i++)expect(commands[i]-commands[i-1]).toBeLessThanOrEqual(4);
  c.cancel();
});
it('large errors receive stronger steering during launch while forward remains reduced',async()=>{
  expect(followLaunchRamp(0,.2)).toEqual({steering:.5,forward:0});
  expect(followLaunchRamp(0,.6).steering).toBeCloseTo(.85);
  expect(followLaunchRamp(100,.6).forward).toBe(.2);
  const {c,send}=setup();await lock(c,[.6,.6,.6,.6]);await vi.advanceTimersByTimeAsync(200);
  const [left,right]=send.mock.calls.at(-1)!;expect(left).toBeGreaterThan(right);expect(left).toBeLessThan(40);c.cancel();
});
it('confidence fluctuations and brief loss do not restart the launch clock',async()=>{
  const {c}=setup();
  for(let i=0;i<4;i++){if(i)await vi.advanceTimersByTimeAsync(100);await c.updateTracked(tracked(.25),performance.now(),750,TRACKED_FOLLOW_DEFAULTS);}
  await vi.advanceTimersByTimeAsync(100);await c.updateTracked(tracked(.25,.8),performance.now(),750,TRACKED_FOLLOW_DEFAULTS);
  const before=c.commandSnapshot.forwardRamp;
  await vi.advanceTimersByTimeAsync(100);await c.updateTracked({...tracked(.25),state:'TEMPORARILY_LOST'},performance.now(),750,TRACKED_FOLLOW_DEFAULTS);
  await vi.advanceTimersByTimeAsync(100);await c.updateTracked(tracked(.25,.7),performance.now(),750,TRACKED_FOLLOW_DEFAULTS);
  expect(c.commandSnapshot.forwardRamp).toBeGreaterThan(before);expect(c.commandSnapshot.forwardRamp).toBeCloseTo(.6);c.cancel();
});
it('missing target clears unfinished averaging and expired locks require new settling',async()=>{
  const {c,lost}=setup();await c.update([box(.5)]);await vi.advanceTimersByTimeAsync(100);await c.update([]);
  await vi.advanceTimersByTimeAsync(100);await c.update([box(.2)]);
  expect(c.commandSnapshot.smoothedError).toBeCloseTo(.2);
  await vi.advanceTimersByTimeAsync(750);expect(lost).toHaveBeenCalledOnce();
  const next=new FollowController(action,vi.fn().mockResolvedValue(undefined),vi.fn(),vi.fn());
  await next.update([box(0)]);expect(next.commandSnapshot).toMatchObject({targetLock:'Settling',forwardRamp:0});next.cancel();
});
it('zero commands bypass launch ramps and cancellation prevents all subsequent motor ticks',async()=>{
  const {c,send}=setup();await lock(c,[0,0,0,0]);await vi.advanceTimersByTimeAsync(200);
  expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  // A size change within the existing association limit reaches the stop distance.
  await c.update([{x:.3,y:.2,width:.4,height:.3}]);
  await c.update([{x:.3,y:.2,width:.4,height:.35}]);
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]);
  c.cancel();const count=send.mock.calls.length;await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(count);expect(vi.getTimerCount()).toBe(0);
  expect(FOLLOW_LAUNCH).toMatchObject({steeringMs:600,forwardMs:500,initialSteering:.5,largeError:.30,largeErrorSteering:.85});
});
