import { afterEach, expect, it, vi } from 'vitest';
import { FollowController, followWheels, FOLLOW_DEFAULTS, type FollowTarget } from '../src/core/FollowController';
import { followTargets } from '../src/core/DetectionManager';
import { ActionEngine } from '../src/core/ActionEngine';
import { RuleEngine } from '../src/core/RuleEngine';
import { makeAction, makeProject, makeRule, type Detection } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
import { compatibleRule, TM_CAPABILITIES, YOLO_CAPABILITIES } from '../src/core/VisionCapabilities';
import { MockRobotAdapter } from './MockRobotAdapter';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuleCard } from '../src/components/RuleCard';
const action = {...makeAction('move'), ...FOLLOW_DEFAULTS, mode:'follow' as const};
const box = (cx=0.5, area=0.04): FollowTarget => ({x:cx-Math.sqrt(area)/2,y:0.2,width:Math.sqrt(area),height:Math.sqrt(area)});
const detection = (cx=0.5, area=0.04): Detection => { const b=box(cx,area); return {...b,x:b.x*640,y:b.y*480,width:b.width*640,height:b.height*480,centerX:cx*640,centerY:144,className:'person',confidence:0.9,region:'center',areaRatio:area}; };
const rule=()=>({...makeRule(),minDuration:0,actions:[{...action}]});
afterEach(()=>vi.useRealTimers());
it('drives centered targets equally and honors center tolerance',()=>{
  expect(followWheels(box(),action)[0]).toBeGreaterThan(0);
  expect(followWheels(box(),action)[0]).toBe(followWheels(box(),action)[1]);
  expect(followWheels(box(0.56),action)[0]).toBe(followWheels(box(0.56),action)[1]);
});
it('curves progressively left and right without pivoting',()=>{
  const slight=followWheels(box(0.4),action), far=followWheels(box(0.1),action),right=followWheels(box(0.9),action);
  expect(slight[0]).toBeLessThan(slight[1]); expect(far[1]-far[0]).toBeGreaterThan(slight[1]-slight[0]);
  expect(right[0]).toBeGreaterThan(right[1]); expect([...slight,...far,...right].every(v=>v>=0&&v<=35)).toBe(true);
});
it('stops at target size or closer, including off-center targets',()=>{
  expect(followWheels(box(0.5,0.14),action)).toEqual([0,0]);
  expect(followWheels(box(0.1,0.3),action)).toEqual([0,0]);
});
it('selects initial largest then nearest previous target',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined);
  const c=new FollowController(action,send,vi.fn(),vi.fn());
  const large=box(0.3,0.08); await c.update([box(0.8),large]); expect(c.target).toBe(large);
  const nearby=box(0.31,0.03); await c.update([box(0.9,0.12),nearby]); expect(c.target).toBe(nearby);
  c.cancel();
});
it('holds briefly on loss, then clears and stops independently of new frames',async()=>{
  vi.useFakeTimers(); const stop=vi.fn(); const c=new FollowController(action,vi.fn().mockResolvedValue(undefined),stop,vi.fn());
  await c.update([box()]); await c.update([]); await vi.advanceTimersByTimeAsync(749);
  expect(c.target).not.toBeNull(); expect(stop).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(c.target).toBeNull(); expect(stop).toHaveBeenCalledOnce();
});
it('does not resend unchanged wheel commands; cancellation prevents future commands',async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined); const c=new FollowController(action,send,vi.fn(),vi.fn());
  await c.update([box()]); await c.update([box(0.51)]); expect(send).toHaveBeenCalledOnce();
  c.cancel(); await c.update([box(0.2)]); expect(send).toHaveBeenCalledOnce();
});
it('rule activation retains a brief missed frame, but not disabled rules',()=>{
  const engine=new RuleEngine(),r=rule();
  engine.evaluate([r],[detection()],0); expect(engine.activeRules).toHaveLength(1);
  engine.evaluate([r],[],749); expect(engine.activeRules).toHaveLength(1);
  engine.evaluate([r],[],750); expect(engine.activeRules).toHaveLength(0);
  engine.evaluate([{...r,enabled:false}],[detection()],800); expect(engine.activeRules).toHaveLength(0);
});
it('filters target class, confidence, location and distance before normalization',()=>{
  const r={...rule(),region:'left' as const};
  expect(followTargets(r,[detection()],640,480)).toEqual([]);
  expect(followTargets(rule(),[detection()],640,480)[0]).toEqual(box());
});
class Wheels extends MockRobotAdapter {
  setWheelSpeeds=vi.fn(async(left:number,right:number)=>{this.state.left=left;this.state.right=right;});
}
it('Follow loss cannot stop a newer continuous owner, and emergency STOP cancels Follow',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot); const r=rule();
  const frame={detections:[detection()],width:640,height:480};
  await engine.updateRules([r],[r],frame); expect(engine.activeMotorOwnerRuleId).toBe(r.id);
  const newer={...rule(),actions:[{...makeAction('move'),mode:'continuous' as const,speed:20}]};
  await engine.updateRules([newer],[r,newer],frame);
  await vi.advanceTimersByTimeAsync(800); expect(robot.state.left).toBe(20); expect(engine.activeMotorOwnerRuleId).toBe(newer.id);
  await engine.stop(); await engine.updateRules([r],[r],frame); await engine.stop();
  const calls=robot.setWheelSpeeds.mock.calls.length; await vi.advanceTimersByTimeAsync(1000);
  expect(robot.state.left).toBe(0); expect(engine.activeMotorOwnerRuleId).toBeNull(); expect(robot.setWheelSpeeds).toHaveBeenCalledTimes(calls);
});
it('lost-target timer stops owned wheels, then permits reacquisition',async()=>{
  vi.useFakeTimers(); const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot),r=rule();
  const frame={detections:[detection()],width:640,height:480};
  await engine.updateRules([r],[r],frame); await vi.advanceTimersByTimeAsync(750);
  expect(robot.state.left).toBe(0); expect(engine.activeMotorOwnerRuleId).toBeNull();
  await engine.updateRules([r],[r],frame); expect(robot.state.left).toBeGreaterThan(0); await engine.stop();
});
it('persists Follow settings and retains legacy timed defaults',()=>{
  const p={...makeProject(),rules:[{...rule(),actions:[{...action,followSpeed:20}]}]};
  expect(parseProject(JSON.stringify(p)).rules[0].actions[0]).toMatchObject({...FOLLOW_DEFAULTS,mode:'follow',followSpeed:20});
  const old=makeProject(); delete old.rules[0].actions[0].mode;
  expect(parseProject(JSON.stringify(old)).rules[0].actions[0].mode).toBe('timed');
  p.rules[0].actions[0].centerDeadZone=2; expect(()=>parseProject(JSON.stringify(p))).toThrow();
});
it('classification providers cannot activate Follow and the editor disables it',()=>{
  const r=rule(); expect(compatibleRule(r,TM_CAPABILITIES)).toBe(false); expect(compatibleRule(r,YOLO_CAPABILITIES)).toBe(true);
  const markup=renderToStaticMarkup(<RuleCard rule={r} index={0} onChange={()=>{}} onDelete={()=>{}} capabilities={['move']} selectedClasses={['person']} visionCapabilities={TM_CAPABILITIES}/>);
  expect(markup).toMatch(/<option value="follow" disabled=""/);
  expect(markup).toContain('Follow speed'); expect(markup).not.toContain('Move direction'); expect(markup).not.toContain('Duration (ms)');
});
it('holds still through distance-boundary jitter and resumes after a clear retreat', async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined);
  const c=new FollowController(action,send,vi.fn(),vi.fn());
  await c.update([box(0.5,0.08)]); expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  await c.update([box(0.5,0.126)]); expect(send.mock.calls.at(-1)!.slice(0,2)).toEqual([0,0]);
  const count=send.mock.calls.length;
  for(const area of [0.121,0.127,0.12,0.124]) await c.update([box(0.5,area)]);
  expect(send).toHaveBeenCalledTimes(count);
  await c.update([box(0.5,0.07)]); expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(0); c.cancel();
});
it('smooths steering changes while keeping the outside wheel moving', async()=>{
  vi.useFakeTimers(); const send=vi.fn().mockResolvedValue(undefined);
  const c=new FollowController(action,send,vi.fn(),vi.fn()); await c.update([box()]);
  await c.update([box(0.1)]); const first=send.mock.calls.at(-1)!.slice(0,2);
  await c.update([box(0.1)]); const second=send.mock.calls.at(-1)!.slice(0,2);
  expect(first[0]).toBeGreaterThan(second[0]); expect(first[1]).toBe(second[1]);
  expect(first[0]).toBeGreaterThan(followWheels(box(0.1),action)[0]); c.cancel();
});
