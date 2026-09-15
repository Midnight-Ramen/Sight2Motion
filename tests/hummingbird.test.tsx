import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HummingbirdAdapter, positionByte, rotationByte } from '../src/core/HummingbirdAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { ActionEngine } from '../src/core/ActionEngine';
import { ROBOTS, portsFor, resetActions } from '../src/core/RobotCapabilities';
import { makeAction, makeProject, makeRule, type Rule } from '../src/core/types';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { RuleCard } from '../src/components/RuleCard';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  vi.useFakeTimers();
  const paths: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async url => { paths.push(String(url)); return new Response(String(url).includes('/in/') ? 'true' : '200'); });
  const robot = new HummingbirdAdapter(() => {}, new BirdBrainTransport(fetcher));
  await robot.connect();
  paths.length = 0;
  const engine = new ActionEngine(robot);
  return { robot, engine, paths, fetcher };
}
const rotationRule = (port: number): Rule => ({ ...makeRule(), minDuration: 0,
  actions: [{ ...makeAction('rotationServo'), port, speed: 25, mode: 'continuous' }] });

it('has only real robot choices and keeps Finch capabilities unchanged', () => {
  expect(Object.keys(ROBOTS)).toEqual(['finch', 'hummingbird']);
  expect(ROBOTS.finch.actions).toEqual(['beak', 'tail', 'tailLightSequence', 'move', 'wait', 'stop']);
  expect(ROBOTS.hummingbird.actions).toEqual(['singleLed', 'triLed', 'positionServo', 'rotationServo', 'stop', 'wait']);
  expect(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')).not.toMatch(/MockRobot|Mock Finch|FinchView/);
  expect(readFileSync(new URL('../src/core/RobotAdapter.ts', import.meta.url), 'utf8')).not.toContain('class Mock');
});

it('resets lights and position port 2 while stopping rotation and preserving rules', async () => {
  const s = await setup(), rule = rotationRule(1);
  const original = JSON.stringify(rule);
  await s.engine.updateRules([rule], [rule]);
  s.paths.length = 0;
  expect(await s.engine.reset(resetActions('hummingbird', [rule]))).toBe(true);
  expect(s.paths).toContain('http://127.0.0.1:30061/hummingbird/out/rotation/1/255/A');
  expect(s.paths).toContain('http://127.0.0.1:30061/hummingbird/out/servo/2/127/A');
  expect(s.paths.filter(p => p.includes('/led/'))).toHaveLength(3);
  expect(s.paths.filter(p => p.includes('/triled/'))).toHaveLength(2);
  expect(s.paths.some(p => p.includes('/servo/1/'))).toBe(false);
  expect(JSON.stringify(rule)).toBe(original);
});

it('shows only compatible choices and marks preserved Finch actions unavailable', () => {
  const html = renderToStaticMarkup(<RuleCard rule={makeRule()} index={0} selectedClasses={['person']}
    capabilities={ROBOTS.hummingbird.actions} robotName="Hummingbird Bit" onChange={() => {}} onDelete={() => {}} />);
  expect(html).toContain('Not available for Hummingbird Bit');
  expect(html).toContain('value="singleLed"');
  expect(html).not.toContain('value="beak"');
  expect(html).not.toContain('value="move"');
  expect(portsFor('singleLed')).toEqual([1, 2, 3]);
  expect(portsFor('triLed')).toEqual([1, 2]);
  expect(portsFor('rotationServo')).toEqual([1, 2, 3, 4]);
});

it('maps single LED brightness and tri-color RGB to the existing byte endpoints', async () => {
  const s = await setup();
  await s.engine.run([{ ...makeAction('singleLed'), port: 3, brightness: 75 }, { ...makeAction('triLed'), port: 2, color: '#00ff80' }]);
  expect(s.paths.map(p => p.split('/out/')[1])).toEqual(['led/3/191/A', 'triled/2/0/255/128/A']);
});

it('clamps position angles and encodes rotation forward, reverse, and stop', () => {
  expect([-10, 0, 90, 180, 250].map(positionByte)).toEqual([0, 0, 127, 254, 254]);
  expect([25, -25, 0].map(rotationByte)).toEqual([127, 116, 255]);
});

it('runs a timed reverse rotation and stops that port at the deadline', async () => {
  const s = await setup();
  const task = s.engine.run([{ ...makeAction('rotationServo'), port: 2, direction: 'backward', speed: 25, duration: 500 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.paths.at(-1)).toContain('/rotation/2/116/A');
  await vi.advanceTimersByTimeAsync(500);
  expect(await task).toBe(true);
  expect(s.paths.at(-1)).toContain('/rotation/2/255/A');
});

it('starts once across frames and stops on rule loss', async () => {
  const s = await setup(), rule = rotationRule(1);
  await s.engine.updateRules([rule], [rule]);
  await s.engine.updateRules([rule], [rule]);
  await s.engine.updateRules([], [rule]);
  expect(s.paths).toHaveLength(1);
  await s.engine.updateRules([], []);
  expect(s.paths.at(-1)).toContain('/rotation/1/255/A');
  expect(s.engine.activeOutputOwners.size).toBe(0);
});

it('owns independent servo outputs and does not stop port 2 when port 1 ends', async () => {
  const s = await setup(), first = rotationRule(1), second = rotationRule(2);
  await s.engine.updateRules([first], [first]);
  await s.engine.updateRules([second], [first, second]);
  expect(s.engine.activeOutputOwners.size).toBe(2);
  s.paths.length = 0;
  await s.engine.updateRules([], [second]);
  expect(s.paths).toHaveLength(1);
  expect(s.paths[0]).toContain('/rotation/1/255/A');
  expect(s.engine.activeOutputOwners.get('servo:2')).toBe(second.id);
});

it('an old rule cannot stop a newer owner of the same port', async () => {
  const s = await setup(), old = rotationRule(1), newer = rotationRule(1);
  newer.actions[0].speed = 50;
  await s.engine.updateRules([old], [old]);
  await s.engine.updateRules([newer], [old, newer]);
  s.paths.length = 0;
  await s.engine.updateRules([], [newer]);
  expect(s.paths).toHaveLength(0);
  expect(s.engine.activeOutputOwners.get('servo:1')).toBe(newer.id);
});

it('releasing an output during a wait does not stop another continuous output', async () => {
  const s = await setup(), first = rotationRule(1), second = rotationRule(2);
  await s.engine.updateRules([first, second], [first, second]);
  const task = s.engine.run([{ ...makeAction('wait'), duration: 5000 }]);
  s.paths.length = 0;
  await s.engine.updateRules([], [second]);
  expect(await task).toBe(false);
  expect(s.paths).toHaveLength(1);
  expect(s.paths[0]).toContain('/rotation/1/255/A');
  expect(s.engine.activeOutputOwners.get('servo:2')).toBe(second.id);
});

it('emergency STOP stops rotation outputs, cancels timed actions, and preserves LEDs and position angles', async () => {
  const s = await setup(), first = rotationRule(1);
  await s.engine.updateRules([first], [first]);
  await s.engine.run([{ ...makeAction('positionServo'), port: 3, angle: 90 }, makeAction('singleLed')]);
  const task = s.engine.run([{ ...makeAction('rotationServo'), port: 2, duration: 5000 }, makeAction('positionServo')]);
  await vi.advanceTimersByTimeAsync(0);
  s.paths.length = 0;
  await s.engine.stop();
  await task;
  expect(s.paths.some(p => p.includes('/rotation/1/255/A'))).toBe(true);
  expect(s.paths.some(p => p.includes('/rotation/2/255/A'))).toBe(true);
  expect(s.paths.every(p => p.includes('/rotation/'))).toBe(true);
  expect(s.engine.activeOutputOwners.size).toBe(0);
});

it('a position command replaces rotation ownership on the same physical port', async () => {
  const s = await setup(), rule = rotationRule(1);
  await s.engine.updateRules([rule], [rule]);
  await s.engine.run([{ ...makeAction('positionServo'), angle: 150 }]);
  s.paths.length = 0;
  await s.engine.updateRules([], []);
  await s.engine.stop();
  expect(s.paths).toHaveLength(0);
});

it('never executes incompatible Finch actions on Hummingbird', async () => {
  const s = await setup();
  await s.engine.run([makeAction('beak'), makeAction('move'), makeAction('tailLightSequence')]);
  expect(s.paths).toHaveLength(0);
});

it('persists output settings through save/load and duplicate JSON, and migrates legacy Finch projects', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const p = makeProject(); p.robotType = 'hummingbird';
  p.rules[0].actions = [{ ...makeAction('singleLed'), port: 3, brightness: 75 }, { ...makeAction('triLed'), port: 2, color: '#00ff00' },
    { ...makeAction('positionServo'), port: 4, angle: 150 }, { ...makeAction('rotationServo'), port: 2, mode: 'continuous', direction: 'backward' }];
  const store = new ProjectStorage(); store.save(p);
  expect(parseProject(JSON.stringify(structuredClone(store.list()[0])))).toEqual(p);
  expect(parseProject(JSON.stringify({ ...makeProject(), robotType: 'mock-finch' })).robotType).toBe('finch');
});

it('disconnect stops active rotation outputs and cancels connection polling', async () => {
  const s = await setup();
  const rule = rotationRule(4); await s.engine.updateRules([rule], [rule]);
  await s.robot.disconnect();
  expect(s.paths.at(-1)).toContain('/rotation/4/255/A');
  const calls = s.paths.length; await vi.advanceTimersByTimeAsync(2000);
  expect(s.paths).toHaveLength(calls);
});

it('rejects a different robot identity without sending output commands', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('false'));
  const robot = new HummingbirdAdapter(() => {}, new BirdBrainTransport(fetcher));
  await expect(robot.connect()).rejects.toThrow('Connect Hummingbird Bit');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(robot.connected).toBe(false);
});

it('stops all owned rotation outputs after an output communication error', async () => {
  const s = await setup();
  const first = rotationRule(1), second = rotationRule(2);
  await s.engine.updateRules([first, second], [first, second]);
  s.paths.length = 0;
  s.fetcher.mockImplementationOnce(async () => new Response('Not Connected'));
  expect(await s.engine.run([makeAction('singleLed')])).toBe(false);
  expect(s.paths).toContain('http://127.0.0.1:30061/hummingbird/out/rotation/1/255/A');
  expect(s.paths).toContain('http://127.0.0.1:30061/hummingbird/out/rotation/2/255/A');
  expect(s.engine.activeOutputOwners.size).toBe(0);
});
