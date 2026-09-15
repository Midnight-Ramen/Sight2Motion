import { afterEach, expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/core/ActionEngine';
import { RuleEngine } from '../src/core/RuleEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import { makeAction, makeProject, makeRule, type Detection, type Rule } from '../src/core/types';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { FinchAdapter } from '../src/core/FinchAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const motionRule = (direction: 'forward' | 'left' | 'right' = 'forward'): Rule => ({
  ...makeRule(), minDuration: 0,
  actions: [{ ...makeAction('move'), direction, mode: 'continuous', speed: 30 }],
});
const person: Detection = { className: 'person', confidence: 0.9, x: 0, y: 0, width: 20, height: 20, centerX: 10, centerY: 10 };
async function setup() {
  const robot = new MockRobotAdapter();
  await robot.connect();
  const commands = vi.spyOn(robot, 'executeAction');
  const stop = vi.spyOn(robot, 'stop');
  const engine = new ActionEngine(robot);
  return { robot, commands, stop, engine };
}

it('keeps legacy/timed movement duration and stop behavior', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const { mode, ...legacy } = makeAction('move');
  const task = s.engine.run([{ ...legacy, duration: 1000 }]);
  expect(s.robot.state.left).toBe(40);
  await vi.advanceTimersByTimeAsync(999);
  expect(s.robot.state.left).toBe(40);
  await vi.advanceTimersByTimeAsync(1);
  expect(await task).toBe(true);
  expect(s.robot.state.left).toBe(0);
});

it('starts once, persists across frames and trigger repeats, then stops on loss', async () => {
  const s = await setup();
  const rule = motionRule();
  await s.engine.updateRules([rule], [rule]);
  for (let i = 0; i < 5; i++) await s.engine.updateRules([rule], [rule]);
  expect(s.commands).toHaveBeenCalledTimes(1);
  expect(s.robot.state.left).toBe(30);
  expect(s.engine.activeMotorOwnerRuleId).toBe(rule.id);
  await s.engine.updateRules([], []);
  expect(s.robot.state.left).toBe(0);
  expect(s.robot.state.right).toBe(0);
  expect(s.engine.activeMotorOwnerRuleId).toBeNull();
});

it('executes later non-motion actions without waiting for continuous motion to end', async () => {
  const s = await setup();
  const rule = motionRule();
  rule.actions = [makeAction('beak'), ...rule.actions, { ...makeAction('tail'), tailLights: [1], color: '#0000ff' }];
  expect(await s.engine.updateRules([rule], [rule])).toBe(true);
  expect(s.commands.mock.calls.map(c => c[0].kind)).toEqual(['beak', 'move', 'tail']);
  expect(s.robot.state.tails[0]).toBe('#0000ff');
  expect(s.robot.state.left).toBe(30);
  expect(s.engine.busy).toBe(false);
});

it('replaces LEFT with CENTER and never lets old LEFT loss stop CENTER', async () => {
  const s = await setup();
  const left = motionRule('left'), center = motionRule();
  await s.engine.updateRules([left], [left]);
  await s.engine.updateRules([center], [left, center]);
  expect(s.engine.activeMotorOwnerRuleId).toBe(center.id);
  expect(s.robot.state.left).toBe(30);
  s.stop.mockClear();
  await s.engine.updateRules([], [center]);
  expect(s.stop).not.toHaveBeenCalled();
  expect(s.robot.state.left).toBe(30);
});

it('hands off on a non-overlapping frame and stops a departing owner during a wait', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const left = motionRule('left'), right = motionRule('right');
  await s.engine.updateRules([left], [left]);
  await s.engine.updateRules([right], [right]);
  expect([s.robot.state.left, s.robot.state.right]).toEqual([30, -30]);
  const task = s.engine.run([{ ...makeAction('wait'), duration: 5000 }, makeAction('move')]);
  await s.engine.updateRules([], []);
  expect(await task).toBe(false);
  expect(s.robot.state.left).toBe(0);
});

it('honors initial minimum duration but starts again without waiting for cooldown', async () => {
  const s = await setup(), rules = new RuleEngine();
  const rule = { ...motionRule(), minDuration: 500 };
  const frame = async (detections: Detection[], time: number) => {
    const triggered = rules.evaluate([rule], detections, time);
    await s.engine.updateRules(triggered, rules.activeRules);
    return triggered;
  };
  await frame([person], 0);
  expect(s.commands).not.toHaveBeenCalled();
  await frame([person], 500);
  await frame([], 600);
  await frame([person], 700);
  expect(await frame([person], 1200)).toEqual([]);
  expect(s.commands).toHaveBeenCalledTimes(2);
  expect(s.robot.state.left).toBe(30);
});

it('explicit STOP overrides ownership immediately even with a busy sequence', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const rule = motionRule(), stopRule = { ...makeRule(), actions: [makeAction('stop')] };
  await s.engine.updateRules([rule], [rule]);
  const task = s.engine.run([{ ...makeAction('wait'), duration: 5000 }, makeAction('move')]);
  await s.engine.updateRules([stopRule], [rule, stopRule]);
  expect(await task).toBe(false);
  expect(s.engine.activeMotorOwnerRuleId).toBeNull();
  expect(s.robot.state.left).toBe(0);
  await s.engine.updateRules([], [rule, stopRule]);
  expect(s.robot.state.left).toBe(0);
});

it('STOP still applies when newly active during its trigger cooldown', async () => {
  const s = await setup();
  const rule = motionRule(), stopRule = { ...makeRule(), actions: [makeAction('stop')] };
  await s.engine.updateRules([rule], [rule]);
  await s.engine.updateRules([], [rule, stopRule]);
  expect(s.engine.activeMotorOwnerRuleId).toBeNull();
  expect(s.robot.state.left).toBe(0);
});

it('emergency stop clears ownership and cancels pending actions and handoffs', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const rule = motionRule();
  rule.actions.push({ ...makeAction('wait'), duration: 5000 }, makeAction('move'));
  const task = s.engine.updateRules([rule], [rule]);
  await vi.advanceTimersByTimeAsync(0);
  const next = motionRule('right');
  const handoff = s.engine.updateRules([next], [next]);
  await s.engine.stop();
  await Promise.all([task, handoff]);
  expect(s.engine.activeMotorOwnerRuleId).toBeNull();
  expect(s.robot.state.left).toBe(0);
  expect(s.commands.mock.calls.filter(c => c[0].kind === 'move')).toHaveLength(1);
});

it('does not start a delayed continuous action after its rule has gone false', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const rule = motionRule();
  rule.actions.unshift({ ...makeAction('wait'), duration: 1000 });
  const task = s.engine.updateRules([rule], [rule]);
  await vi.advanceTimersByTimeAsync(0);
  await s.engine.updateRules([], []);
  await vi.advanceTimersByTimeAsync(1000);
  await task;
  expect(s.robot.state.left).toBe(0);
  expect(s.commands.mock.calls.some(c => c[0].kind === 'move')).toBe(false);
});

it('drains cancelled timed movement before replacing it with persistent motion', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const task = s.engine.run([{ ...makeAction('move'), duration: 5000 }]);
  const rule = motionRule('right');
  await s.engine.updateRules([rule], [rule]);
  expect(await task).toBe(false);
  await vi.advanceTimersByTimeAsync(6000);
  expect([s.robot.state.left, s.robot.state.right]).toEqual([30, -30]);
});

it('keeps a pending handoff across frames while an old action finishes cancellation', async () => {
  const s = await setup();
  const left = motionRule('left'), center = motionRule();
  await s.engine.updateRules([left], [left]);
  let finish!: () => void;
  s.commands.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  const old = s.engine.run([makeAction('beak')]);
  const handoff = s.engine.updateRules([center], [center]);
  await s.engine.updateRules([], [center]);
  await s.engine.updateRules([], [center]);
  finish();
  await Promise.all([old, handoff]);
  expect(s.engine.activeMotorOwnerRuleId).toBe(center.id);
  expect(s.robot.state.left).toBe(30);
});

it('clears ownership and stops on a robot execution error', async () => {
  const s = await setup();
  const rule = motionRule();
  await s.engine.updateRules([rule], [rule]);
  s.commands.mockRejectedValueOnce(new Error('offline'));
  expect(await s.engine.run([makeAction('beak')])).toBe(false);
  expect(s.engine.activeMotorOwnerRuleId).toBeNull();
  expect(s.robot.state.left).toBe(0);
});

it('persists motion mode through storage, duplication and JSON; migrates legacy actions', () => {
  const rows = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v) });
  const project = makeProject();
  project.rules = [motionRule()];
  const storage = new ProjectStorage();
  storage.save(project);
  const duplicate = structuredClone(storage.list()[0]);
  expect(parseProject(JSON.stringify(duplicate)).rules[0].actions[0].mode).toBe('continuous');
  delete duplicate.rules[0].actions[0].mode;
  expect(parseProject(JSON.stringify(duplicate)).rules[0].actions[0].mode).toBe('timed');
  expect(() => parseProject(JSON.stringify(project).replace('"mode":"continuous"', '"mode":"forever"'))).toThrow();
});

it('real Finch uses one existing wheel command, renews only its watchdog, and releases on loss', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(async url => new Response(String(url).includes('/in/') ? 'true' : '200'));
  const watchdog = { arm: vi.fn(async () => {}), disarm: vi.fn() };
  const robot = new FinchAdapter(() => {}, new BirdBrainTransport(fetcher), 'A', watchdog);
  await robot.connect();
  const engine = new ActionEngine(robot), rule = motionRule('left');
  try {
    await engine.updateRules([rule], [rule]);
    await vi.advanceTimersByTimeAsync(2500);
    await engine.updateRules([rule], [rule]);
    const wheels = () => fetcher.mock.calls.filter(c => String(c[0]).includes('/wheels/'));
    expect(wheels()).toHaveLength(1);
    expect(String(wheels()[0][0])).toContain('/wheels/A/-30/30/');
    expect(watchdog.arm.mock.calls.length).toBeGreaterThan(1);
    await engine.updateRules([], []);
    expect(engine.activeMotorOwnerRuleId).toBeNull();
    const renewals = watchdog.arm.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(watchdog.arm).toHaveBeenCalledTimes(renewals);
    expect(watchdog.disarm).toHaveBeenCalled();
    expect(fetcher.mock.calls.some(c => String(c[0]).includes('/stopall/A'))).toBe(true);
  } finally { await robot.disconnect(); }
});

it('real Finch attempts STOP if continuous watchdog renewal fails', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(async url => new Response(String(url).includes('/in/') ? 'true' : '200'));
  const watchdog = { arm: vi.fn(async () => {}), disarm: vi.fn() };
  const robot = new FinchAdapter(() => {}, new BirdBrainTransport(fetcher), 'A', watchdog);
  await robot.connect();
  const engine = new ActionEngine(robot), rule = motionRule();
  try {
    await engine.updateRules([rule], [rule]);
    watchdog.arm.mockRejectedValueOnce(new Error('worker failed'));
    await vi.advanceTimersByTimeAsync(300);
    expect(robot.status.connection).toBe('error');
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('/stopall/A');
    // The app pauses ActionEngine when the selected adapter reports disconnection/error.
    await engine.stop();
    expect(engine.activeMotorOwnerRuleId).toBeNull();
  } finally { await robot.disconnect(); }
});
