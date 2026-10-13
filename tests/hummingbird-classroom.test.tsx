import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuleEngine } from '../src/core/RuleEngine';
import { ActionEngine } from '../src/core/ActionEngine';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import { HummingbirdAdapter, positionByte } from '../src/core/HummingbirdAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { classroomRules, servoHomeAction, homeAngleForPort } from '../src/core/HummingbirdClassroom';
import { makeAction, makeProject, makeRule, type Rule } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
import { HummingbirdOutputs } from '../src/components/HummingbirdOutputs';
import { RuleCard } from '../src/components/RuleCard';
import { ROBOTS } from '../src/core/RobotCapabilities';
afterEach(() => vi.useRealTimers());
const detected = [{ className: 'plastic', confidence: .9 }];
const sortingRule = (): Rule => ({ ...makeRule(), className: 'plastic', mode: 'appearance', minDuration: 500, cooldown: 100,
  actions: [{ ...makeAction('positionServo'), angle: 30, returnHome: true }, { ...makeAction('wait'), duration: 750 }] });
function hardware() {
  const paths: string[] = [];
  const robot = new HummingbirdAdapter(() => {}, new BirdBrainTransport(vi.fn(async url => { paths.push(String(url)); return new Response(String(url).includes('/in/') ? 'true' : '200'); }) as typeof fetch));
  robot.status.connection = 'connected';
  const engine = new ActionEngine(robot);
  return { engine, paths, robot };
}
it('Once per detection qualifies once, stays latched, and disappears to re-arm', () => {
  const engine = new RuleEngine(), rule = sortingRule();
  expect(engine.evaluate([rule], detected, 0)).toEqual([]);
  expect(engine.evaluate([rule], detected, 499)).toEqual([]);
  expect(engine.evaluate([rule], detected, 500)).toHaveLength(1);
  expect(engine.evaluate([rule], detected, 5000)).toEqual([]);
  expect(engine.evaluate([rule], [], 5100)).toEqual([]);
  expect(engine.evaluate([rule], detected, 5200)).toEqual([]);
  expect(engine.evaluate([rule], detected, 5700)).toHaveLength(1);
});
it('While visible retains its existing cooldown-based repeated trigger', () => {
  const engine = new RuleEngine(), rule = { ...sortingRule(), mode: 'continuous' as const };
  engine.evaluate([rule], detected, 0);
  expect(engine.evaluate([rule], detected, 500)).toHaveLength(1);
  expect(engine.evaluate([rule], detected, 550)).toEqual([]);
  expect(engine.evaluate([rule], detected, 600)).toHaveLength(1);
});
it('Servo Home sends configured port/angle with Play OFF', async () => {
  const { engine, paths } = hardware();
  expect(await engine.run([servoHomeAction({ port: 4, angle: 120 })])).toBe(true);
  expect(paths).toContain(`http://127.0.0.1:30061/hummingbird/out/servo/4/${positionByte(120)}/A`);
});
it('Play rule pipeline executes target, existing Wait, then Home in order', async () => {
  vi.useFakeTimers();
  const { engine, paths } = hardware(), conditions = new RuleEngine();
  const coordinator = new BaseBehaviorCoordinator(engine);
  const rule = sortingRule(), home = { port: 1, angle: 90 };
  conditions.evaluate([rule], detected, 0);
  const triggered = conditions.evaluate([rule], detected, 500);
  const run = coordinator.update(classroomRules(triggered, home), classroomRules(conditions.activeRules, home));
  await vi.advanceTimersByTimeAsync(749);
  expect(paths.filter(p => p.includes('/servo/'))).toEqual([`http://127.0.0.1:30061/hummingbird/out/servo/1/${positionByte(30)}/A`]);
  await vi.advanceTimersByTimeAsync(1); await run;
  expect(paths.filter(p => p.includes('/servo/'))).toEqual([`http://127.0.0.1:30061/hummingbird/out/servo/1/${positionByte(30)}/A`, 'http://127.0.0.1:30061/hummingbird/out/servo/1/127/A']);
});
it('Return Home immediately returns without Wait and does not mutate saved actions', async () => {
  const { engine, paths } = hardware(), rule = sortingRule(); rule.actions.pop();
  const original = JSON.stringify(rule);
  await engine.run(classroomRules([rule], { port: 1, angle: 80 })[0].actions);
  expect(paths.filter(p => p.includes('/servo/'))).toHaveLength(2);
  expect(paths.at(-1)).toContain(`/servo/1/${positionByte(80)}/A`);
  expect(JSON.stringify(rule)).toBe(original);
  expect(homeAngleForPort({ port: 1, angle: 80 }, 2)).toBe(90);
});
it('STOP during Wait aborts the Home command and stops outputs', async () => {
  vi.useFakeTimers(); const { engine, paths } = hardware();
  const stop = vi.spyOn(engine, 'stop');
  const run = engine.run(classroomRules([sortingRule()], { port: 1, angle: 90 })[0].actions);
  await vi.advanceTimersByTimeAsync(100); await engine.stop(); await run;
  await vi.advanceTimersByTimeAsync(1000);
  expect(paths.filter(p => p.includes('/servo/'))).toHaveLength(1);
  expect(stop).toHaveBeenCalledTimes(1);
});
it('direct LED, tri-color LED and bounded motor tests run with Play OFF', async () => {
  vi.useFakeTimers(); const { engine, paths } = hardware();
  await engine.run([{ ...makeAction('singleLed'), port: 3, brightness: 50 }, { ...makeAction('triLed'), port: 2, color: '#0000ff' }]);
  const motor = engine.run([{ ...makeAction('rotationServo'), port: 4, speed: 25, duration: 500 }]);
  await vi.advanceTimersByTimeAsync(500); await motor;
  expect(paths.some(p => p.includes('/led/3/127/A'))).toBe(true);
  expect(paths.some(p => p.includes('/triled/2/0/0/255/A'))).toBe(true);
  expect(paths.filter(p => p.includes('/rotation/4/'))).toHaveLength(2);
});
it('classroom controls are available when connected with Play OFF', () => {
  const markup = renderToStaticMarkup(<HummingbirdOutputs connected busy={false} onAction={() => {}} onStop={() => {}} />);
  expect(markup).toContain('Servo Home'); expect(markup).toContain('Move Home'); expect(markup).toContain('Test outputs'); expect(markup).not.toContain('disabled');
  expect(markup).not.toContain('Play');
  const rule = renderToStaticMarkup(<RuleCard rule={sortingRule()} index={0} selectedClasses={['plastic']} capabilities={ROBOTS.hummingbird.actions} onChange={() => {}} onDelete={() => {}} />);
  expect(rule).toContain('Once per detection'); expect(rule).toContain('While visible'); expect(rule).toContain('Return Home');
});
it('old projects stay valid and new optional Home/helper settings round-trip', () => {
  const old = { ...makeProject(), robotType: 'hummingbird' as const, rules: [{ ...sortingRule(), actions: [makeAction('positionServo')] }] };
  expect(parseProject(JSON.stringify(old)).servoHome).toBeUndefined();
  const project = { ...old, servoHome: { port: 2, angle: 110 }, rules: [sortingRule()] };
  const parsed = parseProject(JSON.stringify(project));
  expect(parsed.servoHome).toEqual(project.servoHome); expect(parsed.rules[0].actions[0].returnHome).toBe(true);
  expect(() => parseProject(JSON.stringify({ ...project, servoHome: { port: 5, angle: 90 } }))).toThrow();
});

it('STOP interrupts a connected rotation servo test and sends its neutral stop command', async () => {
  vi.useFakeTimers(); const { engine, paths, robot } = hardware();
  await robot.connect(); paths.length = 0;
  const run = engine.run([{ ...makeAction('rotationServo'), port: 3, speed: 25, duration: 1000 }]);
  await vi.advanceTimersByTimeAsync(100); await engine.stop(); await run;
  expect(paths.some(p => p.includes('/rotation/3/255/A'))).toBe(true);
  await robot.disconnect();
});
