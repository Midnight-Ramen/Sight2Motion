import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinchAdapter } from '../src/core/FinchAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { SensorProvider } from '../src/core/SensorProvider';
import { FINCH_SENSORS, FINCH_ORIENTATIONS, finchSensorDescriptor, normalizeSensor, sensorMatches, type SensorState, type SensorValue, type FinchSensorType } from '../src/core/Sensors';
import { RuleEngine } from '../src/core/RuleEngine';
import { DetectionManager } from '../src/core/DetectionManager';
import { ActionEngine } from '../src/core/ActionEngine';
import { makeRule, makeAction, makeProject, type Rule, type Detection } from '../src/core/types';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { setupReadiness } from '../src/core/SetupReadiness';
import { SensorInputs } from '../src/components/SensorInputs';
import { SensorConditions } from '../src/components/SensorConditions';
import { RuleCard } from '../src/components/RuleCard';
import { MockRobotAdapter } from './MockRobotAdapter';
import { TRACKED_FOLLOW_DEFAULTS } from '../src/core/FollowController';
import type { TrackedTarget } from '../src/core/TargetTracker';
import { LiveDiagnostics } from '../src/components/LiveDiagnostics';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const distance = finchSensorDescriptor('finchDistance');
const condition = { id: 'distance', sensorId: distance.id, operator: 'lessThan' as const, value: 15 };
const rule = (): Rule => ({ ...makeRule(), source: 'sensor', className: '', minDuration: 0, cooldown: 100,
  sensorConditions: [condition], actions: [makeAction('stop')] });
const sample = (value = 10, updatedAt = 0) => ({ available: true, configuration: [distance],
  state: { [distance.id]: { reading: { kind: 'number' as const, value, unit: 'cm' }, updatedAt } } });
const person: Detection = { className: 'person', confidence: .95, x: 240, y: 140, width: 100, height: 150, centerX: 290, centerY: 215, region: 'center', areaRatio: .05 };
function adapter(respond: (path: string) => string = () => '10') {
  const paths: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname; paths.push(path);
    return new Response(path.includes('isFinch') ? 'true' : path.includes('/out/') ? '200' : respond(path));
  });
  const robot = new FinchAdapter(() => {}, new BirdBrainTransport(fetcher), 'B', { arm: vi.fn(async () => {}), disarm: vi.fn() });
  return { robot, paths, fetcher };
}

it.each([
  ['finchDistance', 'Distance/static', '37', 37, 'cm'],
  ['finchLineLeft', 'Line/Left', '18', 18, ''],
  ['finchLineRight', 'Line/Right', '82', 82, ''],
  ['finchLightLeft', 'Light/Left', '64', 64, '%'],
  ['finchLightRight', 'Light/Right', '67', 67, '%'],
  ['finchEncoderLeft', 'Encoder/Left', '-1.24', -1.24, 'rotations'],
  ['finchEncoderRight', 'Encoder/Right', '1.19', 1.19, 'rotations'],
] as const)('reads verified %s endpoint without rescaling', async (type, path, raw, value, unit) => {
  const s = adapter(() => raw); await s.robot.connect();
  expect(await s.robot.readSensor(finchSensorDescriptor(type), new AbortController().signal)).toEqual({ kind: 'number', value, unit });
  expect(s.paths).toContain(`/hummingbird/in/${path}/B`);
  await s.robot.disconnect();
});

it('uses named orientation queries serially at 100 ms cadence, including In between', async () => {
  vi.useFakeTimers();
  let orientation = 'Level';
  const s = adapter(path => String(decodeURIComponent(path).includes(`/${orientation}/`)));
  await s.robot.connect();
  for (const name of FINCH_ORIENTATIONS) {
    orientation = name;
    const pending = s.robot.readSensor(finchSensorDescriptor('finchOrientation'), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ kind: 'string', value: name });
  }
  expect(s.paths).toContain('/hummingbird/in/finchOrientation/Beak%20Up/B');
  expect(s.paths.some(p => p.includes('Accelerometer'))).toBe(false);
  await s.robot.disconnect();
});

it('rejects unavailable, nonfinite and out-of-range sensor values', () => {
  for (const raw of ['', 'Not Connected', 'NaN', '12bad', 'Infinity']) expect(normalizeSensor('finchDistance', raw)).toBeNull();
  expect(normalizeSensor('finchLightLeft', '101')).toBeNull();
  expect(normalizeSensor('finchLineLeft', '-1')).toBeNull();
  expect(normalizeSensor('finchOrientation', 'unknown')).toBeNull();
});

it('reuses SensorProvider and clears readings and polling on disconnect', async () => {
  vi.useFakeTimers(); const s = adapter(); await s.robot.connect();
  expect(s.robot.sensors).toBeInstanceOf(SensorProvider);
  const changed = vi.fn(); s.robot.sensors.start([distance], changed);
  await vi.advanceTimersByTimeAsync(250);
  expect(changed.mock.calls.at(-1)?.[0][distance.id].reading.value).toBe(10);
  expect(s.paths.every(p => !p.includes('Compass'))).toBe(true);
  await s.robot.disconnect(); const count = s.paths.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.paths.length).toBe(count); expect(changed).toHaveBeenLastCalledWith({});
});

it('cancels orientation queries mid-cycle on disconnect and reconnect starts fresh', async () => {
  vi.useFakeTimers(); const s = adapter(() => 'false'); await s.robot.connect();
  const changed = vi.fn(); s.robot.sensors.start([finchSensorDescriptor('finchOrientation')], changed);
  await vi.advanceTimersByTimeAsync(150); await s.robot.disconnect();
  const count = s.paths.length; await vi.advanceTimersByTimeAsync(800);
  expect(s.paths.length).toBe(count); expect(changed).toHaveBeenLastCalledWith({});
  await s.robot.connect();
  expect(s.paths.filter(p => p.includes('finchOrientation')).length).toBe(2);
  await s.robot.disconnect();
});

it('clears sensors when the existing connection heartbeat detects loss', async () => {
  vi.useFakeTimers(); const s = adapter(); await s.robot.connect();
  const changed = vi.fn(); s.robot.sensors.start([distance], changed);
  await vi.advanceTimersByTimeAsync(200);
  s.fetcher.mockImplementation(async url => new Response(String(url).includes('isFinch') ? 'false' : String(url).includes('/out/') ? '200' : '10'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.robot.connected).toBe(false); expect(changed).toHaveBeenLastCalledWith({});
  expect(s.paths.filter(p => p.includes('Compass'))).toEqual([]);
  await s.robot.disconnect();
});

it('does not overlap reads even when a cancelled read settles late during restart', async () => {
  vi.useFakeTimers(); let finish!: (value: SensorValue | null) => void;
  const read = vi.fn(() => new Promise<SensorValue | null>(resolve => { finish = resolve; }));
  const provider = new SensorProvider(read), changed = vi.fn();
  provider.start([distance], changed); provider.start([distance], changed);
  await vi.advanceTimersByTimeAsync(1000); expect(read).toHaveBeenCalledTimes(1);
  finish(null); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(2);
  provider.stop(); finish(null); await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenLastCalledWith({});
});

it('sensor-only triggers without a class or DetectionManager and preserves timing', () => {
  const detect = vi.spyOn(DetectionManager.prototype, 'update'), engine = new RuleEngine(), r = rule(); r.minDuration = 100;
  expect(engine.evaluate([r], [], 0, undefined, sample())).toEqual([]);
  expect(engine.evaluate([r], [], 100, undefined, sample())).toEqual([r]);
  expect(engine.evaluate([r], [], 200, undefined, sample())).toEqual([]);
  expect(detect).not.toHaveBeenCalled();
  expect(engine.diagnostics[r.id]).toBe('TRUE');
});

it('Vision + Sensor requires both, and legacy vision remains unchanged', () => {
  const engine = new RuleEngine(), r = { ...rule(), source: 'vision-sensor' as const, className: 'person' };
  expect(engine.evaluate([r], [], 0, undefined, sample())).toEqual([]);
  expect(engine.evaluate([r], [person], 100, undefined, sample(25))).toEqual([]);
  expect(engine.evaluate([r], [person], 200, undefined, sample())).toEqual([r]);
  const legacy = { ...makeRule(), minDuration: 0 };
  expect(engine.evaluate([legacy], [person], 300)).toEqual([legacy]);
});

it('never triggers from stale, missing, disconnected or future readings', () => {
  for (const [now, data] of [[751, sample()], [0, { ...sample(), available: false }], [0, { ...sample(), state: {} }], [0, sample(10, 1)]] as const) {
    const engine = new RuleEngine(), r = rule();
    expect(engine.evaluate([r], [], now, undefined, data)).toEqual([]);
    expect(engine.activeRules).toEqual([]); expect(engine.diagnostics[r.id]).toBe('Waiting');
  }
});

it('requires both line conditions and releases active rule when either fails', () => {
  const sensors = [finchSensorDescriptor('finchLineLeft'), finchSensorDescriptor('finchLineRight')];
  const r = { ...rule(), sensorConditions: sensors.map(s => ({ ...condition, id: s.id, sensorId: s.id, value: 40 })) };
  const state: SensorState = Object.fromEntries(sensors.map(s => [s.id, { reading: { kind: 'number', value: 18 }, updatedAt: 0 }]));
  const engine = new RuleEngine();
  expect(engine.evaluate([r], [], 0, undefined, { available: true, configuration: sensors, state })).toEqual([r]);
  state[sensors[1].id].reading = { kind: 'number', value: 82 };
  expect(engine.evaluate([r], [], 100, undefined, { available: true, configuration: sensors, state })).toEqual([]);
  expect(engine.activeRules).toEqual([]);
});

it('orientation supports named equality only', () => {
  const c = { ...condition, sensorId: 'finchOrientation', operator: 'equals' as const, value: 'Level' };
  const state = { finchOrientation: { reading: { kind: 'string' as const, value: 'Level' }, updatedAt: 0 } };
  expect(sensorMatches(c, state, 0)).toBe(true);
  expect(sensorMatches({ ...c, operator: 'lessThan' }, state, 0)).toBe(false);
  expect(sensorMatches(c, state, 751)).toBe(false);
});

it('a sensor When false Stop fires on fresh false data, not true or stale data', async () => {
  const robot = new MockRobotAdapter(); await robot.connect();
  const stop = vi.spyOn(robot, 'stop'), actions = new ActionEngine(robot), rules = new RuleEngine();
  const r = { ...rule(), mode: 'disappearance' as const };
  await actions.updateRules(rules.evaluate([r], [], 0, undefined, sample()), rules.activeRules);
  expect(stop).not.toHaveBeenCalled();
  await actions.updateRules(rules.evaluate([r], [], 100, undefined, sample(30, 100)), rules.activeRules);
  expect(stop).toHaveBeenCalled(); stop.mockClear(); rules.reset();
  rules.evaluate([r], [], 200, undefined, sample(10, 200));
  expect(rules.evaluate([r], [], 1000, undefined, sample(10, 200))).toEqual([]);
  expect(stop).not.toHaveBeenCalled();
});

it.each(['timed', 'continuous', 'follow'] as const)('sensor Stop interrupts %s motion and blocks competing motion while true', async mode => {
  vi.useFakeTimers(); const robot = new MockRobotAdapter(); await robot.connect();
  const wheels = vi.fn(async (left: number, right: number) => { robot.state.left = left; robot.state.right = right; });
  const engine = new ActionEngine(Object.assign(robot, { setWheelSpeeds: wheels }));
  const move: Rule = { ...makeRule(), minDuration: 0, actions: [{ ...makeAction('move'), mode, duration: 5000 }] };
  const frame = { detections: [person], width: 640, height: 480, capturedAt: performance.now() };
  const running = engine.updateRules([move], [move], frame);
  await vi.advanceTimersByTimeAsync(0);
  const r = rule(), rules = new RuleEngine();
  const triggered = rules.evaluate([r], [], 0, undefined, sample());
  await engine.updateRules([move, ...triggered], [move, ...rules.activeRules], frame);
  await running;
  expect([robot.state.left, robot.state.right]).toEqual([0, 0]);
  const count = wheels.mock.calls.length;
  await engine.updateRules([move], [move, r], frame);
  await vi.advanceTimersByTimeAsync(1000);
  expect(wheels).toHaveBeenCalledTimes(count);
  expect(engine.activeMotorOwnerRuleId).toBeNull();
  expect([robot.state.left, robot.state.right]).toEqual([0, 0]);
  await engine.stop();
});

it('sensor-only project is ready without camera/model/classes; missing sensor is not ready', () => {
  const project = { ...makeProject(), rules: [rule()], selectedClasses: [], sensorConfiguration: [distance] };
  const state = { usableFrame: false, modelReady: false, classes: [], connected: true, hardwareBusy: false, running: false, demo: false };
  expect(setupReadiness(project, state).play).toBe(true);
  expect(setupReadiness({ ...project, sensorConfiguration: [] }, state).play).toBe(false);
  project.rules[0].actions = [{ ...makeAction('move'), mode: 'follow' }];
  expect(setupReadiness(project, state).play).toBe(false);
});

it('sensor Stop cancels selected-target Follow through the existing ActionEngine path', async () => {
  vi.useFakeTimers(); const robot = new MockRobotAdapter(); await robot.connect();
  const wheels = vi.fn(async () => {});
  const engine = new ActionEngine(Object.assign(robot, { connected: true, setWheelSpeeds: wheels }));
  const target: TrackedTarget = { active: true, state: 'TRACKING', label: 'cup', centerX: 320, centerY: 240,
    boundingBox: { x: 300, y: 220, width: 40, height: 40 }, relativeX: .5, relativeY: .5,
    normalizedWidth: .1, normalizedHeight: .1, normalizedArea: .01, size: .01, errorX: 0,
    horizontalError: 0, confidence: .9, trackingConfidence: .9, lostFrames: 0, targetLost: false };
  await engine.startSelectedFollow(target, performance.now(), 750, TRACKED_FOLLOW_DEFAULTS);
  expect(engine.followingSelectedTarget).toBe(true);
  const r = rule(); await engine.updateRules([r], [r]);
  expect(engine.followingSelectedTarget).toBe(false);
  const count = wheels.mock.calls.length; await vi.advanceTimersByTimeAsync(1000);
  expect(wheels).toHaveBeenCalledTimes(count);
});

it('round-trips Finch sensors and all rule modes without introducing dummy classes', () => {
  const configuration = Object.keys(FINCH_SENSORS).map(type => finchSensorDescriptor(type as FinchSensorType));
  const r = rule(); r.sensorConditions!.push({ id: 'orientation', sensorId: 'finchOrientation', operator: 'equals', value: 'Level' });
  const project = { ...makeProject(), selectedClasses: [], sensorConfiguration: configuration, rules: [r] };
  const parsed = parseProject(JSON.stringify(project));
  expect(parsed.selectedClasses).toEqual([]); expect(parsed.rules[0].source).toBe('sensor');
  expect(parsed.rules[0].sensorConditions).toEqual(r.sensorConditions); expect(parsed.sensorConfiguration).toEqual(configuration);
  const store = new Map(); vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  new ProjectStorage().save(parsed); expect(new ProjectStorage().list()).toEqual([parsed]);
  expect(() => parseProject(JSON.stringify({ ...project, sensorConfiguration: [{ id: 'finchHeading', type: 'finchHeading' }] }))).toThrow();
  expect(() => parseProject(JSON.stringify({ ...project, rules: [{ ...r, sensorConditions: [{ ...condition, sensorId: 'finchHeading' }] }] }))).toThrow();
});

it('renders built-in sensors without ports, unavailable heading, and sensor-only editor without class', () => {
  const sensors = Object.keys(FINCH_SENSORS).map(type => finchSensorDescriptor(type as FinchSensorType));
  const inputs = renderToStaticMarkup(<SensorInputs robotType="finch" configuration={sensors} state={{}} onChange={() => {}} />);
  expect(inputs).toContain('No data — calibration status unavailable'); expect(inputs).not.toContain('Input 1 sensor');
  const conditions = renderToStaticMarkup(<SensorConditions conditions={[condition]} sensors={sensors} available onChange={() => {}} />);
  expect(conditions).not.toContain('Heading');
  const html = renderToStaticMarkup(<RuleCard rule={rule()} index={0} onChange={() => {}} onDelete={() => {}} capabilities={['stop']} selectedClasses={[]} sensors={sensors} sensorsAvailable />);
  expect(html).toContain('Condition source'); expect(html).not.toContain('Detected class'); expect(html).toContain('Sensor condition 1 input');
  const diagnostics = renderToStaticMarkup(<LiveDiagnostics project={{ ...makeProject(), sensorConfiguration: sensors }}
    detections={[]} target={null} sensors={{ finchEncoderLeft: { reading: { kind: 'number', value: -1.24, unit: 'rotations' }, updatedAt: 0 },
      finchOrientation: { reading: { kind: 'string', value: 'Level' }, updatedAt: 0 } }}
    ruleResults={{}} follow={{ selected: false, target: undefined }} camera={false} model={false} robot running={false} fps={0} demo={false} now={100} />);
  expect(diagnostics).toContain('-1.24 rotations'); expect(diagnostics).toContain('Orientation: Level');
  expect(diagnostics).toContain('Heading: No data — calibration status unavailable');
});
