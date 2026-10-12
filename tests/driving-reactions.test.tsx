import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import { ActionEngine } from '../src/core/ActionEngine';
import { drivingOverride, reactionSpeed, veerWheels, startVeer, type DrivingOverride } from '../src/core/DrivingReactions';
import { makeAction, makeProject, makeRule, type ActionKind, type Rule } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
import { RuleCard } from '../src/components/RuleCard';
import { ROBOTS } from '../src/core/RobotCapabilities';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const rule = (kind: ActionKind, speed = 50) => ({ ...makeRule(), actions: [{ ...makeAction(kind), speed }] });
function setup() {
  const engine = { busy: false, updateRules: vi.fn(async (_triggered: Rule[], _active: Rule[]) => true), stop: vi.fn(async () => {}) };
  const coordinator = new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
  const driver = { safe: vi.fn(() => true), suspend: vi.fn(), start: vi.fn(async (_override?: DrivingOverride) => true) };
  return { engine, coordinator, driver };
}
it.each(['slowDown', 'setSpeed', 'veerLeft', 'veerRight'] as const)('%s is temporary, stable while true, and restores base on clear', async kind => {
  const { coordinator, driver, engine } = setup();
  coordinator.arm(driver); await settle();
  const reaction = rule(kind, 30);
  await coordinator.update([reaction], [reaction]);
  expect(driver.start).toHaveBeenLastCalledWith({ kind, speed: 30 });
  expect(driver.suspend).toHaveBeenCalledTimes(1);
  await coordinator.update([], [reaction]);
  expect(driver.start).toHaveBeenCalledTimes(2);
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenLastCalledWith(undefined);
  expect(driver.start).toHaveBeenCalledTimes(3);
  expect(engine.updateRules.mock.calls.every(args => args.slice(0, 2).every(rules => rules.every(r => !r.actions.some(a => a.kind === kind))))).toBe(true);
});
it('uses chosen speed for Slow Down without increasing base speed and sets absolute speed', () => {
  expect(reactionSpeed(40, { kind: 'slowDown', speed: 20 })).toBe(20);
  expect(reactionSpeed(40, { kind: 'setSpeed', speed: 70 })).toBe(70);
  expect(reactionSpeed(40)).toBe(40);
  expect(reactionSpeed(1, { kind: 'slowDown', speed: 99 })).toBe(1);
});
it('veers with gentle positive wheel speeds and symmetric direction', () => {
  expect(veerWheels(40, 'veerLeft')).toEqual([16, 40]);
  expect(veerWheels(40, 'veerRight')).toEqual([40, 16]);
  expect(veerWheels(1, 'veerLeft')).toEqual([1, 1]);
});
it('resolves competing overrides in rule order and restores the next active override before base', async () => {
  const { coordinator, driver } = setup(); coordinator.arm(driver); await settle();
  const slow = rule('slowDown'), speed = rule('setSpeed', 25);
  await coordinator.update([slow, speed], [slow, speed]);
  expect(driver.start).toHaveBeenLastCalledWith({ kind: 'slowDown', speed: 50 });
  await coordinator.update([], [speed]);
  expect(driver.start).toHaveBeenLastCalledWith({ kind: 'setSpeed', speed: 25 });
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenLastCalledWith(undefined);
});
it('STOP holds priority over overrides and explicit resume', async () => {
  const { coordinator, driver, engine } = setup(); coordinator.arm(driver); await settle();
  const slow = rule('slowDown'), stop = rule('stop'), resume = rule('resumeBase');
  await coordinator.update([slow], [slow]);
  const starts = driver.start.mock.calls.length;
  await coordinator.update([stop, resume], [slow, stop, resume]);
  expect(driver.start).toHaveBeenCalledTimes(starts);
  expect(engine.updateRules.mock.calls.at(-1)?.[1]).toEqual([stop]);
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenLastCalledWith(undefined);
});
it('explicit resume relinquishes an override until its condition clears and re-enters', async () => {
  const { coordinator, driver, engine } = setup(); coordinator.arm(driver); await settle();
  const slow = rule('slowDown'), resume = rule('resumeBase');
  await coordinator.update([slow], [slow]);
  await coordinator.update([resume], [slow, resume]);
  expect(engine.stop).toHaveBeenCalled();
  expect(driver.start).toHaveBeenLastCalledWith(undefined);
  const starts = driver.start.mock.calls.length;
  await coordinator.update([], [slow]);
  expect(driver.start).toHaveBeenCalledTimes(starts);
  await coordinator.update([], []);
  await coordinator.update([slow], [slow]);
  expect(driver.start).toHaveBeenLastCalledWith({ kind: 'slowDown', speed: 50 });
});
it.each(['global STOP', 'manual takeover', 'disconnect'])('resume cannot rearm after %s', async () => {
  const { coordinator, driver } = setup(); coordinator.arm(driver); await settle();
  const slow = rule('slowDown'); await coordinator.update([slow], [slow]);
  coordinator.disarm();
  const starts = driver.start.mock.calls.length, resume = rule('resumeBase');
  await coordinator.update([resume], [resume]); await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(starts);
  expect(coordinator.enabled).toBe(false);
});
it('emergency braking cancels an override and prevents automatic rearming', async () => {
  const { coordinator, driver, engine } = setup(); coordinator.arm(driver); await settle();
  const veer = rule('veerRight'); await coordinator.update([veer], [veer]);
  coordinator.safety = () => false; await coordinator.update([], [veer]);
  expect(engine.stop).toHaveBeenCalled(); expect(coordinator.enabled).toBe(false);
  coordinator.safety = () => true; await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(2);
});
it('STOP during a pending override startup invalidates its eventual completion', async () => {
  const { coordinator, driver } = setup(); coordinator.arm(driver); await settle();
  let complete!: (value: boolean) => void;
  driver.start.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const slow = rule('slowDown');
  const update = coordinator.update([slow], [slow]); await settle();
  coordinator.disarm(); complete(true); await update;
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(2);
  expect(coordinator.active).toBe(false);
  expect(coordinator.enabled).toBe(false);
});
it('does not arm a base session from a driving rule alone or apply disabled overrides', async () => {
  const { coordinator, driver } = setup(); const slow = rule('slowDown');
  await coordinator.update([slow], [slow]); expect(driver.start).not.toHaveBeenCalled();
  expect(drivingOverride([{ ...slow, actions: [{ ...slow.actions[0], enabled: false }] }], [])).toBeUndefined();
});
it('retains signal actions in a mixed driving rule and resumes the override after the signal completes', async () => {
  const { coordinator, driver, engine } = setup(); coordinator.arm(driver); await settle();
  const mixed = { ...rule('slowDown'), actions: [makeAction('slowDown'), makeAction('beak')] };
  await coordinator.update([mixed], [mixed]);
  expect(engine.updateRules.mock.calls.at(-1)?.[0][0].actions.map(action => action.kind)).toEqual(['beak']);
  await coordinator.update([], [mixed]);
  expect(driver.start).toHaveBeenLastCalledWith({ kind: 'slowDown', speed: 20 });
});
it('round-trips new actions without altering existing move/turn data', () => {
  const project = makeProject();
  project.rules[0].actions = ['slowDown', 'setSpeed', 'veerLeft', 'veerRight', 'resumeBase', 'move'].map(kind => makeAction(kind as ActionKind));
  project.rules[0].actions.at(-1)!.direction = 'left';
  const restored = parseProject(JSON.stringify(project));
  expect(restored.rules[0].actions.map(action => action.kind)).toEqual(project.rules[0].actions.map(action => action.kind));
  expect(restored.rules[0].actions.at(-1)?.direction).toBe('left');
  restored.rules[0].actions[0].speed = 101;
  expect(() => parseProject(JSON.stringify(restored))).toThrow();
  restored.rules[0].actions[0].speed = 50; restored.robotType = 'hummingbird';
  expect(() => parseProject(JSON.stringify(restored))).toThrow();
});
it('groups Finch actions in Driving and Signals with only relevant speed controls', () => {
  const markup = renderToStaticMarkup(<RuleCard rule={rule('slowDown')} index={0} selectedClasses={['person']} capabilities={ROBOTS.finch.actions} onChange={() => {}} onDelete={() => {}} />);
  expect(markup).toContain('<optgroup label="Driving">'); expect(markup).toContain('<optgroup label="Signals">');
  for (const label of ['Slow Down', 'Set Speed', 'Steer Left', 'Steer Right', 'Turn Left', 'Turn Right', 'Resume Base']) expect(markup).toContain(label);
  expect(markup).toContain('Speed %'); expect(markup).not.toContain('movement mode');
});

it('Slow Down never increases a slower configured base', () => {
  expect(reactionSpeed(15, { kind: 'slowDown', speed: 30 })).toBe(15);
});
it.each(['veerLeft', 'veerRight'] as const)('%s claims existing wheel ownership before differential command', async direction => {
  const events: string[] = [];
  const engine = { updateRules: vi.fn(async (triggered: Rule[], active: Rule[]) => {
    expect(triggered[0].id).toBe(active[0].id);
    expect(active[0].actions[0]).toMatchObject({ kind: 'move', mode: 'continuous', speed: 0 });
    events.push('owner'); return true;
  }) };
  const robot = { connected: true, setWheelSpeeds: vi.fn(async () => { events.push('wheels'); }) };
  const signal = new AbortController().signal;
  expect(await startVeer(engine as unknown as ActionEngine, robot as unknown as import('../src/core/RobotAdapter').RobotAdapter, 40, direction, signal)).toBe(true);
  expect(events).toEqual(['owner', 'wheels']);
  expect(robot.setWheelSpeeds).toHaveBeenCalledWith(...veerWheels(40, direction), 0, signal, 'continuous');
});
it('an aborted veer never sends differential movement after ownership completes', async () => {
  const abort = new AbortController();
  const engine = { updateRules: vi.fn(async () => { abort.abort(); return true; }) };
  const robot = { connected: true, setWheelSpeeds: vi.fn() };
  expect(await startVeer(engine as unknown as ActionEngine, robot as unknown as import('../src/core/RobotAdapter').RobotAdapter, 40, 'veerLeft', abort.signal)).toBe(false);
  expect(robot.setWheelSpeeds).not.toHaveBeenCalled();
});

// Exercise real ActionEngine ownership together with coordinator evaluations.
it.each([
  ['veerLeft', 8, 20], ['veerRight', 20, 8],
] as const)('%s commands correct wheel mapping, holds ownership, then restores base', async (kind, left, right) => {
  const commands: [number, number][] = [];
  const robot: import('../src/core/RobotAdapter').RobotAdapter = {
    connected: true,
    connect: async () => {}, disconnect: async () => {},
    getCapabilities: () => ['move', 'stop'],
    stop: async () => { commands.push([0, 0]); },
    setWheelSpeeds: async (l, r) => { commands.push([l, r]); },
    executeAction: async action => {
      if (action.kind === 'move') commands.push([action.speed, action.speed]);
      if (action.kind === 'stop') commands.push([0, 0]);
    },
  };
  const engine = new ActionEngine(robot);
  const coordinator = new BaseBehaviorCoordinator(engine);
  let abort = new AbortController();
  const driver = {
    safe: () => true,
    suspend: () => { abort.abort(); return engine.stop(); },
    start: async (override?: DrivingOverride) => {
      abort = new AbortController();
      if (override?.kind === 'veerLeft' || override?.kind === 'veerRight')
        return startVeer(engine, robot, 20, override.kind, abort.signal);
      const base = { ...makeRule(), id: 'base-test', actions: [{ ...makeAction('move'), speed: 20, mode: 'continuous' as const }] };
      return engine.updateRules([base], [base]);
    },
  };
  coordinator.arm(driver); await settle();
  expect(commands.at(-1)).toEqual([20, 20]);
  const reaction = rule(kind);
  await coordinator.update([reaction], [reaction]);
  expect(commands.at(-1)).toEqual([left, right]);
  const owner = engine.activeMotorOwnerRuleId;
  expect(owner).toMatch(/^reaction-/);
  const count = commands.length;
  for (let i = 0; i < 10; i++) await coordinator.update([], [reaction]);
  expect(engine.activeMotorOwnerRuleId).toBe(owner);
  expect(commands).toHaveLength(count);
  expect(commands.at(-1)).toEqual([left, right]);
  await coordinator.update([], []);
  expect(engine.activeMotorOwnerRuleId).toBe('base-test');
  expect(commands.at(-1)).toEqual([20, 20]);
  coordinator.disarm();
});
