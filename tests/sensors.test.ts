import { afterEach, expect, it, vi } from 'vitest';
import { normalizeSensor, sensorDescriptor, sensorMatches, type SensorCondition, type SensorState } from '../src/core/Sensors';
import { SensorProvider } from '../src/core/SensorProvider';
import { HummingbirdAdapter } from '../src/core/HummingbirdAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { RuleEngine } from '../src/core/RuleEngine';
import { ActionEngine } from '../src/core/ActionEngine';
import { makeProject, makeRule, makeAction, type VisionResult } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
afterEach(() => { vi.useRealTimers(); });
const distance = sensorDescriptor('distance', 1), light = sensorDescriptor('light', 2);
const condition: SensorCondition = { id: 'c1', sensorId: distance.id, operator: 'lessThan', value: 20 };
const sample = (value: number, updatedAt = 0): SensorState => ({ [distance.id]: { reading: { kind: 'number', value }, updatedAt } });
const person: VisionResult[] = [{ className: 'person', confidence: 0.99, x: 0.4, y: 0.2, width: 0.2, height: 0.4, centerX: 0.5, centerY: 0.4, region: 'center', areaRatio: 0.08 }];
const input = (state: SensorState, available = true) => ({ state, available, configuration: [distance, light] });

it('normalizes the documented raw readings and rejects unavailable values', () => {
  expect(normalizeSensor('distance', '24')).toEqual({ kind: 'number', value: 28, unit: 'cm' });
  expect(normalizeSensor('light', '161')?.value).toBe(63);
  expect(normalizeSensor('sound', '16')?.value).toBe(12);
  expect(normalizeSensor('sound', '255')?.value).toBe(100);
  expect(normalizeSensor('analog', '255')?.value).toBe(100);
  for (const raw of ['', 'Not Connected', 'NaN', '-1', '256', '12oops']) expect(normalizeSensor('distance', raw)).toBeNull();
});
it('matches each numeric operator with boundaries', () => {
  const expectations = { lessThan: false, lessThanOrEqual: true, greaterThan: false, greaterThanOrEqual: true, equals: true };
  for (const [operator, result] of Object.entries(expectations)) {
    expect(sensorMatches({ ...condition, operator: operator as SensorCondition['operator'] }, sample(20), 0)).toBe(result);
  }
  expect(sensorMatches(condition, sample(19), 0)).toBe(true);
  expect(sensorMatches({ ...condition, operator: 'greaterThan' }, sample(21), 0)).toBe(true);
});
it('supports strict boolean equality without coercion or ordering', () => {
  const state: SensorState = { [distance.id]: { reading: { kind: 'boolean', value: true }, updatedAt: 0 } };
  expect(sensorMatches({ ...condition, operator: 'equals', value: true }, state, 0)).toBe(true);
  expect(sensorMatches({ ...condition, operator: 'equals', value: false }, state, 0)).toBe(false);
  expect(sensorMatches({ ...condition, operator: 'greaterThan', value: false }, state, 0)).toBe(false);
  expect(sensorMatches({ ...condition, operator: 'equals', value: 1 }, state, 0)).toBe(false);
});
it('fails missing, stale and unavailable readings safely', () => {
  expect(sensorMatches(condition, {}, 0)).toBe(false);
  expect(sensorMatches(condition, sample(10), 751)).toBe(false);
  expect(sensorMatches(condition, { [distance.id]: { reading: null, updatedAt: 0 } }, 0)).toBe(false);
});
it('requires vision AND every sensor and preserves minimum duration, appearance and cooldown', () => {
  const engine = new RuleEngine();
  const rule = { ...makeRule(), sensorConditions: [condition], minDuration: 100, cooldown: 100 };
  expect(engine.evaluate([rule], person, 0, undefined, input(sample(35)))).toEqual([]);
  expect(engine.evaluate([rule], [], 100, undefined, input(sample(10, 100)))).toEqual([]);
  expect(engine.evaluate([rule], person, 200, undefined, input(sample(10, 200)))).toEqual([]);
  expect(engine.evaluate([rule], person, 300, undefined, input(sample(10, 300)))).toEqual([rule]);
  expect(engine.evaluate([rule], person, 400, undefined, input(sample(10, 400)))).toEqual([]);
  engine.evaluate([rule], person, 500, undefined, input(sample(35, 500)));
  expect(engine.activeRules).toEqual([]);
  engine.evaluate([rule], person, 600, undefined, input(sample(10, 600)));
  expect(engine.evaluate([rule], person, 700, undefined, input(sample(10, 700)))).toEqual([rule]);
  rule.sensorConditions.push({ ...condition, id: 'c2', sensorId: light.id, value: 30 });
  expect(engine.evaluate([rule], person, 800, undefined, input(sample(10, 800)))).toEqual([]);
  const both = { ...sample(10, 900), [light.id]: { reading: { kind: 'number' as const, value: 20 }, updatedAt: 900 } };
  engine.evaluate([rule], person, 900, undefined, input(both));
  expect(engine.evaluate([rule], person, 1000, undefined, input(both))).toEqual([rule]);
});
it('does not execute Hummingbird conditions on Finch or after removing an input', () => {
  const engine = new RuleEngine(), rule = { ...makeRule(), minDuration: 0, sensorConditions: [condition] };
  expect(engine.evaluate([rule], person, 0, undefined, input(sample(10), false))).toEqual([]);
  expect(engine.evaluate([rule], person, 0, undefined, { ...input(sample(10)), configuration: [] })).toEqual([]);
});
it('releases continuous rotation ownership when a sensor becomes false or stale', async () => {
  const paths: string[] = [];
  const robot = new HummingbirdAdapter(() => {}, new BirdBrainTransport(async url => {
    paths.push(String(url)); return new Response(String(url).includes('/in/') ? 'true' : '200');
  }));
  await robot.connect();
  const rules = new RuleEngine(), actions = new ActionEngine(robot);
  const rule = { ...makeRule(), minDuration: 0, cooldown: 100, sensorConditions: [condition], actions: [{ ...makeAction('rotationServo'), mode: 'continuous' as const }] };
  for (const [now, state] of [[0, sample(10)], [100, sample(30, 100)], [200, sample(10, 200)], [1000, sample(10, 200)]] as const) {
    await actions.updateRules(rules.evaluate([rule], person, now, undefined, input(state)), rules.activeRules);
  }
  expect(paths.filter(p => p.includes('/rotation/1/255/A'))).toHaveLength(2);
  expect(actions.activeOutputOwners.size).toBe(0);
  await robot.disconnect();
});
it('defaults legacy projects and round-trips configuration and conditions', () => {
  const project = makeProject();
  delete project.sensorConfiguration; delete project.rules[0].sensorConditions;
  const legacy = parseProject(JSON.stringify(project));
  expect(legacy.sensorConfiguration).toEqual([]);
  expect(legacy.rules[0].sensorConditions).toEqual([]);
  legacy.robotType = 'hummingbird'; legacy.sensorConfiguration = [distance, light]; legacy.rules[0].sensorConditions = [condition];
  expect(parseProject(JSON.stringify(legacy))).toEqual(legacy);
  expect(() => parseProject(JSON.stringify({ ...legacy, sensorConfiguration: [{ ...distance, port: 4 }] }))).toThrow();
});
it('polls serially, discards late results and cancels on stop', async () => {
  vi.useFakeTimers();
  let resolve!: (value: ReturnType<typeof normalizeSensor>) => void;
  const read = vi.fn(() => new Promise<ReturnType<typeof normalizeSensor>>(r => { resolve = r; }));
  const changed = vi.fn(), provider = new SensorProvider(read);
  provider.start([distance, light], changed);
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(1);
  provider.stop(); resolve(normalizeSensor('distance', '10'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith({});
});
it('uses the existing raw sensor route and stops polling on disconnect', async () => {
  vi.useFakeTimers();
  const paths: string[] = [];
  const robot = new HummingbirdAdapter(() => {}, new BirdBrainTransport(async url => {
    const path = String(url); paths.push(path);
    return new Response(path.includes('/sensor/') ? '24' : path.includes('/in/') ? 'true' : '200');
  }));
  await robot.connect(); const changed = vi.fn();
  robot.sensors.start([distance], changed);
  await vi.advanceTimersByTimeAsync(250);
  expect(paths).toContain('http://127.0.0.1:30061/hummingbird/in/sensor/1/A');
  expect(changed.mock.calls.at(-1)?.[0][distance.id].reading.value).toBe(28);
  await robot.disconnect(); const calls = paths.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(paths).toHaveLength(calls);
  expect(changed).toHaveBeenLastCalledWith({});
});
