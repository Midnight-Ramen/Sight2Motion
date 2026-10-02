import { afterEach, expect, it, vi } from 'vitest';
import { FollowController, FOLLOW_ACQUISITION, followDistanceTuning, followWheels, TRACKED_FOLLOW_DEFAULTS } from '../src/core/FollowController';
import { TargetTracker } from '../src/core/TargetTracker';
import { makeAction, type Detection } from '../src/core/types';
const action={...makeAction('move'),mode:'follow' as const,followSpeed:40,centerDeadZone:.15};
const box=(error=0,area=.02)=>({x:(1+error)/2-Math.sqrt(area)/2,y:.2,width:Math.sqrt(area),height:Math.sqrt(area)});
afterEach(()=>vi.useRealTimers());
function setup() {
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined),lost=vi.fn();
  const c=new FollowController(action,send,lost,vi.fn()); return {c,send,lost};
}
it('collects fresh target samples for 300 ms before interpolating motion on the existing tick',async()=>{
  const {c,send}=setup(); await c.update([box()]);
  for(const delay of [125,125,49]) {await vi.advanceTimersByTimeAsync(delay);await c.update([box()]);}
  expect(c.commandSnapshot.targetLock).toBe('Settling');
  expect(send.mock.calls.every(([l,r])=>l===0&&r===0)).toBe(true);
  await vi.advanceTimersByTimeAsync(1);await c.update([box()]);
  expect(c.commandSnapshot.targetLock).toBe('Soft start'); expect(vi.getTimerCount()).toBe(2);
  await vi.advanceTimersByTimeAsync(100);
  expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([4,4]);c.cancel();
});
it('resets unfinished settling after disappearance, but keeps an established lock during brief loss',async()=>{
  const {c}=setup();await c.update([box()]);await vi.advanceTimersByTimeAsync(200);await c.update([]);
  await vi.advanceTimersByTimeAsync(100);await c.update([box()]);
  expect(c.commandSnapshot.targetLock).toBe('Settling');
  await vi.advanceTimersByTimeAsync(300);await c.update([box()]);expect(c.commandSnapshot.targetLock).toBe('Soft start');
  await c.update([]);await vi.advanceTimersByTimeAsync(100);await c.update([box()]);
  expect(c.commandSnapshot.targetLock).toBe('Soft start');c.cancel();
});
it('an expired lock cancels and a restarted Follow settles again',async()=>{
  const {c,lost}=setup();await c.update([box()]);await vi.advanceTimersByTimeAsync(300);await c.update([box()]);
  await vi.advanceTimersByTimeAsync(750);expect(lost).toHaveBeenCalledOnce();expect(c.commandSnapshot.active).toBe(false);
  const next=new FollowController(action,vi.fn().mockResolvedValue(undefined),vi.fn(),vi.fn());
  await next.update([box()]);expect(next.commandSnapshot.targetLock).toBe('Settling');next.cancel();
});
it('existing TargetTracker confidence changes do not restart settling',async()=>{
  const {c}=setup(),tracker=new TargetTracker();
  const detection=(confidence:number):Detection=>({className:'person',confidence,x:280,y:160,width:80,height:120,centerX:320,centerY:220});
  const d=detection(.9);
  let target=tracker.initialize({width:640,height:480,mask:new Uint8Array(),boundingBox:d,centroid:{x:320,y:220},area:9600},[d],false,performance.now())!;
  await c.updateTracked(target,performance.now(),750,TRACKED_FOLLOW_DEFAULTS);
  for(const confidence of [.8,.7,.85]) {
    await vi.advanceTimersByTimeAsync(100);target=tracker.update([detection(confidence)],performance.now())!;
    await c.updateTracked(target,performance.now(),750,TRACKED_FOLLOW_DEFAULTS);
  }
  expect(c.commandSnapshot.targetLock).toBe('Soft start');c.cancel();
});
it('smooth distance scaling ranges from half authority and +4 points tolerance to full authority',()=>{
  expect(followDistanceTuning(.02,.15)).toEqual({steeringScale:.5,deadZone:.19});
  expect(followDistanceTuning(.07,.15).steeringScale).toBeCloseTo(.75);
  expect(followDistanceTuning(.12,.15)).toEqual({steeringScale:1,deadZone:.15});
  expect(followDistanceTuning(.25,.15)).toEqual({steeringScale:1,deadZone:.15});
  followWheels(box(.4),action);expect(action.centerDeadZone).toBe(.15);
  expect(FOLLOW_ACQUISITION.settleMs).toBe(300);
});
it('far centered jitter drives straight and a moderate stable offset curves without alternating',async()=>{
  const {c,send}=setup();
  for(const error of [.03,-.04,.05,-.03,.02,0]) {await c.update([box(error)]);await vi.advanceTimersByTimeAsync(125);}
  expect(send.mock.calls.every(([l,r])=>l===r)).toBe(true);
  for(const error of [.35,.36,.34,.36,.35,.34,.35,.36]) {await c.update([box(error)]);await vi.advanceTimersByTimeAsync(125);}
  expect(send.mock.calls.every(([l,r])=>l>=r)).toBe(true);
  expect(c.commandSnapshot.desired[0]).toBeGreaterThan(c.commandSnapshot.desired[1]);c.cancel();
});
it('large horizontal error reduces forward motion but ordinary offsets retain positive forward drive',()=>{
  const centered=followWheels(box(0),action),moderate=followWheels(box(.4),action),large=followWheels(box(.8),action);
  expect(centered[0]).toBe(centered[1]);
  expect(moderate[0]+moderate[1]).toBeLessThan(centered[0]+centered[1]);
  expect(large[0]+large[1]).toBeLessThan(moderate[0]+moderate[1]);
  expect(moderate[1]).toBeGreaterThan(0);
});
it('STOP/cancel prevents movement during settling and after lock without waiting for interpolation',async()=>{
  for(const locked of [false,true]) {
    const {c,send}=setup();await c.update([box()]);
    if(locked){await vi.advanceTimersByTimeAsync(300);await c.update([box()]);await vi.advanceTimersByTimeAsync(100);}
    c.cancel();const count=send.mock.calls.length;await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(count);expect(vi.getTimerCount()).toBe(0);
  }
});
