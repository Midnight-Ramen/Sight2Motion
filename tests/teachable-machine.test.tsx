import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeachableMachineProvider } from '../src/core/TeachableMachineProvider';
import { normalizeTeachableMachineUrl } from '../src/core/TeachableMachineUrl';
import { capabilitiesFor, classificationRule, compatibleRule, TM_CAPABILITIES, YOLO_CAPABILITIES } from '../src/core/VisionCapabilities';
import { RuleEngine } from '../src/core/RuleEngine';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from '../src/core/RobotAdapter';
import { makeAction, makeProject, makeRule } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
import { RuleCard } from '../src/components/RuleCard';

const base = 'https://teachablemachine.withgoogle.com/models/Test_123-abc/';
it('normalizes a standard shared URL with or without a trailing slash', () => {
  expect(normalizeTeachableMachineUrl(base.slice(0, -1))).toBe(base);
  expect(normalizeTeachableMachineUrl(`  ${base}  `)).toBe(base);
});
it.each([
  'http://teachablemachine.withgoogle.com/models/abc/',
  'https://example.com/models/abc/',
  'https://teachablemachine.withgoogle.com.evil.test/models/abc/',
  'https://user@teachablemachine.withgoogle.com/models/abc/',
  `${base}model.json`, `${base}?url=http://example.com`, `${base}#x`,
  'https://teachablemachine.withgoogle.com/models/', 'javascript:alert(1)',
])('rejects an invalid model link: %s', url => {
  expect(() => normalizeTeachableMachineUrl(url)).toThrow();
});

it('loads actual labels, predicts on the supplied frame, and returns no spatial fields', async () => {
  const model = {
    getClassLabels: () => ['Eraser', 'Marker', 'Nothing'],
    predict: vi.fn(async () => [
      { className: 'Marker', probability: 0.06 }, { className: 'Eraser', probability: 0.91 }, { className: 'Nothing', probability: 0.03 },
    ]), dispose: vi.fn(),
  };
  const load = vi.fn(async () => model);
  const provider = new TeachableMachineProvider(load);
  await provider.load(base.slice(0, -1));
  expect(load).toHaveBeenCalledWith(`${base}model.json`, `${base}metadata.json`);
  expect(provider.getClasses()).toEqual(['Eraser', 'Marker', 'Nothing']);
  const frame = {} as HTMLVideoElement;
  expect(await provider.detect(frame)).toEqual([
    { className: 'Eraser', confidence: 0.91 }, { className: 'Marker', confidence: 0.06 }, { className: 'Nothing', confidence: 0.03 },
  ]);
  expect(model.predict).toHaveBeenCalledWith(frame);
  await provider.dispose();
  expect(model.dispose).toHaveBeenCalledOnce();
  expect(provider.getClasses()).toEqual([]);
});

it('does not invoke the loader for invalid URLs or retain labels after a failed reload', async () => {
  const load = vi.fn(async () => ({ getClassLabels: () => ['Eraser'], predict: vi.fn(), dispose: vi.fn() }));
  const provider = new TeachableMachineProvider(load);
  await expect(provider.load('http://bad.test/')).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
  await provider.load(base);
  load.mockRejectedValueOnce(new Error('offline'));
  await expect(provider.load(base)).rejects.toThrow();
  expect(provider.getClasses()).toEqual([]);
});

it('class confidence uses the existing minimum duration, appearance and cooldown behavior', () => {
  const engine = new RuleEngine();
  const rule = { ...makeRule(), className: 'Eraser', confidence: 0.8 };
  const evaluate = (confidence: number, now: number) => engine.evaluate([rule], [{ className: 'Eraser', confidence }], now, TM_CAPABILITIES);
  expect(evaluate(0.79, 0)).toEqual([]);
  expect(evaluate(0.8, 100)).toEqual([]);
  expect(evaluate(0.91, 600)).toEqual([rule]);
  expect(evaluate(0.91, 700)).toEqual([]);
  expect(evaluate(0.1, 800)).toEqual([]);
  expect(evaluate(0.91, 900)).toEqual([]);
  expect(evaluate(0.91, 1400)).toEqual([]);
  expect(evaluate(0.91, 2600)).toEqual([rule]);
});

it('marks spatial rules incompatible and only converts explicitly without changing other fields', () => {
  const rule = { ...makeRule(), region: 'center' as const, distance: 'near' as const, className: 'Eraser', minDuration: 0 };
  expect(compatibleRule(rule, TM_CAPABILITIES)).toBe(false);
  expect(compatibleRule(rule, YOLO_CAPABILITIES)).toBe(true);
  const engine = new RuleEngine();
  expect(engine.evaluate([rule], [{ className: 'Eraser', confidence: 0.99 }], 0, TM_CAPABILITIES)).toEqual([]);
  expect(engine.activeRules).toEqual([]);
  const converted = classificationRule(rule);
  expect(converted).toEqual({ ...rule, region: 'anywhere', distance: 'any' });
  expect(rule.region).toBe('center');
  expect(engine.evaluate([converted], [{ className: 'Eraser', confidence: 0.99 }], 1, TM_CAPABILITIES)).toEqual([converted]);
});

it('hides spatial editor controls using provider capabilities and keeps YOLO controls', () => {
  const props = { rule: { ...makeRule(), region: 'left' as const }, index: 0, selectedClasses: ['person'], onChange: vi.fn(), onDelete: vi.fn(), capabilities: ['beak' as const] };
  const tm = renderToStaticMarkup(<RuleCard {...props} visionCapabilities={capabilitiesFor('teachable-machine')} />);
  expect(tm).not.toContain('aria-label="Location"');
  expect(tm).not.toContain('aria-label="Distance"');
  expect(tm).toContain('Needs update');
  expect(tm).toContain('Convert to classification rule');
  expect(tm).toContain('aria-label="Class"');
  const yolo = renderToStaticMarkup(<RuleCard {...props} visionCapabilities={capabilitiesFor('yolo')} />);
  expect(yolo).toContain('aria-label="Location"');
  expect(yolo).toContain('aria-label="Distance"');
});

it('uses the existing rule/action/robot path and supports STOP for classification', async () => {
  const robot = new MockRobotAdapter();
  await robot.connect();
  const rules = new RuleEngine(), actions = new ActionEngine(robot);
  const rule = { ...makeRule(), className: 'Eraser', minDuration: 0, actions: [{ ...makeAction(), color: '#00ff00' }] };
  const triggered = rules.evaluate([rule], [{ className: 'Eraser', confidence: 0.91 }], 0, TM_CAPABILITIES);
  await actions.updateRules(triggered, rules.activeRules);
  expect(robot.state.beak).toBe('#00ff00');
  await actions.stop();
  expect([robot.state.left, robot.state.right]).toEqual([0, 0]);
});

it('migrates legacy projects to YOLO and persists provider, normalized URL and classes', () => {
  const { visionProvider, ...legacy } = makeProject();
  expect(parseProject(JSON.stringify(legacy)).visionProvider).toBe('yolo');
  const project = { ...makeProject(), visionProvider: 'teachable-machine', teachableMachineUrl: base.slice(0, -1), selectedClasses: ['Eraser'], rules: [] };
  expect(parseProject(JSON.stringify(project))).toMatchObject({ visionProvider: 'teachable-machine', teachableMachineUrl: base, selectedClasses: ['Eraser'] });
  expect(() => parseProject(JSON.stringify({ ...project, teachableMachineUrl: 'http://example.com' }))).toThrow();
});
