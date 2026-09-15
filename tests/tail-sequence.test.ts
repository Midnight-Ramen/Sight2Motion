import { it, expect, vi } from 'vitest';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import { makeAction, makeProject } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';

it('repeats selected lights in order with individual colors and preserves skipped lights', async () => {
  vi.useFakeTimers();
  try {
    const robot = new MockRobotAdapter(); await robot.connect();
    robot.state.tails[2] = '#123456';
    const spy = vi.spyOn(robot, 'executeAction');
    const action = { ...makeAction('tailLightSequence'), steps: [{light:1,color:'#00ff00'}, {light:2,color:'#0000ff'}, {light:4,color:'#ff00ff'}], repeatCount:2, clearPrevious:false, clearWhenFinished:false };
    const task = new ActionEngine(robot).run([action]);
    await vi.runAllTimersAsync(); expect(await task).toBe(true);
    expect(spy.mock.calls.map(([a]) => [a.tailLights![0], a.color])).toEqual([[1,'#00ff00'],[2,'#0000ff'],[4,'#ff00ff'],[1,'#00ff00'],[2,'#0000ff'],[4,'#ff00ff']]);
    expect(robot.state.tails).toEqual(['#00ff00','#0000ff','#123456','#ff00ff']);
    const p = makeProject(); p.rules[0].actions = [action];
    expect(parseProject(JSON.stringify(p)).rules[0].actions[0]).toEqual(action);
  } finally { vi.useRealTimers(); }
});
it('clears only participating lights between steps and on completion', async () => {
  vi.useFakeTimers();
  try {
    const robot = new MockRobotAdapter(); await robot.connect(); robot.state.tails[3]='#abcdef';
    const spy=vi.spyOn(robot,'executeAction');
    const task=new ActionEngine(robot).run([{...makeAction('tailLightSequence'),steps:[{light:2,color:'#00ff00'}],repeatCount:1}]);
    await vi.runAllTimersAsync(); await task;
    expect(spy.mock.calls.map(([a])=>[a.tailLights![0],a.color])).toEqual([[2,'#00ff00'],[2,'#000000'],[2,'#000000']]);
    expect(robot.state.tails[3]).toBe('#abcdef');
  } finally { vi.useRealTimers(); }
});
it('STOP interrupts the wait and prevents all remaining light commands and later actions', async () => {
  vi.useFakeTimers();
  try {
    const robot=new MockRobotAdapter(); await robot.connect();
    const spy=vi.spyOn(robot,'executeAction'); const engine=new ActionEngine(robot);
    const task=engine.run([makeAction('tailLightSequence'),makeAction('beak')]);
    await vi.advanceTimersByTimeAsync(100);
    await engine.stop(); const count=spy.mock.calls.length;
    await vi.runAllTimersAsync(); expect(await task).toBe(false);
    expect(spy).toHaveBeenCalledTimes(count); expect(count).toBe(1);
    expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
  } finally { vi.useRealTimers(); }
});
