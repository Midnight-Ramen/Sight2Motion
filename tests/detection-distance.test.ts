import { afterEach, expect, it, vi } from 'vitest';
import { detectionAreaRatio, matchesDistance } from '../src/core/DetectionDistance';
import { RuleEngine } from '../src/core/RuleEngine';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';
import { makeProject, makeRule, type Detection } from '../src/core/types';

const detection = (areaRatio: number, region: Detection['region'] = 'center'): Detection => ({
  className: 'person', confidence: 0.9, x: 40, y: 0, width: 20, height: 50,
  centerX: 50, centerY: 25, region, areaRatio,
});
afterEach(() => vi.unstubAllGlobals());

it('normalizes bounding box area independently of camera resolution', () => {
  expect(detectionAreaRatio({ width: 20, height: 50 }, 100, 100)).toBeCloseTo(0.1);
  expect(detectionAreaRatio({ width: 40, height: 100 }, 200, 200)).toBeCloseTo(0.1);
});

it.each([0.08, 0.12, 0.2])('assigns size %s to the correct side of the threshold', size => {
  expect(matchesDistance(detection(size), 'near', 0.12)).toBe(size >= 0.12);
  expect(matchesDistance(detection(size), 'far', 0.12)).toBe(size < 0.12);
  expect(matchesDistance(detection(size), 'any', 0.12)).toBe(true);
});

it('passes any for legacy detections without a size and honors per-rule thresholds', () => {
  const { areaRatio, ...legacy } = detection(0.2);
  expect(matchesDistance(legacy, 'any')).toBe(true);
  expect(matchesDistance(legacy, 'near')).toBe(false);
  expect(matchesDistance(legacy, 'far')).toBe(false);
  expect(matchesDistance(detection(0.2), 'far', 0.25)).toBe(true);
  expect(matchesDistance(detection(0.2), 'near', 0.15)).toBe(true);
});

it('requires class, confidence, region, and size on the same detection', () => {
  const rule = { ...makeRule(), region: 'center' as const, distance: 'near' as const, minDuration: 0 };
  const nearLeft = detection(0.2, 'left');
  const farCenter = detection(0.08);
  const matches = (items: Detection[]) => new RuleEngine().evaluate([rule], items, 0);
  expect(matches([nearLeft, farCenter])).toEqual([]);
  expect(matches([nearLeft, farCenter, { ...detection(0.2), confidence: 0.4 }])).toEqual([]);
  expect(matches([nearLeft, farCenter, { ...detection(0.2), className: 'cat' }])).toEqual([]);
  expect(matches([nearLeft, detection(0.12)])).toEqual([rule]);
  const farRule = { ...rule, distance: 'far' as const };
  expect(new RuleEngine().evaluate([farRule], [nearLeft, farCenter], 0)).toEqual([farRule]);
});

it('preserves visible duration, once-per-appearance, and cooldown across distance changes', () => {
  const rule = { ...makeRule(), distance: 'near' as const };
  const engine = new RuleEngine();
  const near = [detection(0.2)];
  expect(engine.evaluate([rule], near, 0)).toEqual([]);
  expect(engine.evaluate([rule], near, 500)).toEqual([rule]);
  expect(engine.evaluate([rule], near, 1000)).toEqual([]);
  expect(engine.evaluate([rule], [detection(0.08)], 1100)).toEqual([]);
  expect(engine.evaluate([rule], near, 1200)).toEqual([]);
  expect(engine.evaluate([rule], near, 1700)).toEqual([]);
  expect(engine.evaluate([rule], near, 2500)).toEqual([rule]);
});

it('migrates missing distance fields to any and 12%', () => {
  const project = makeProject();
  const { distance, nearThreshold, ...legacy } = project.rules[0];
  const loaded = parseProject(JSON.stringify({ ...project, rules: [legacy] }));
  expect(loaded.rules[0]).toMatchObject({ distance: 'any', nearThreshold: 0.12 });
  expect(new RuleEngine().evaluate([{ ...loaded.rules[0], minDuration: 0 }], [detection(0.01)], 0)).toHaveLength(1);
});

it('preserves distance fields through save/load, duplication, and JSON round trips', () => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const project = makeProject();
  project.rules[0].distance = 'far';
  project.rules[0].nearThreshold = 0.25;
  const storage = new ProjectStorage();
  storage.save(project);
  const duplicate = { ...structuredClone(storage.list()[0]), id: crypto.randomUUID() };
  const imported = parseProject(JSON.stringify(duplicate));
  expect(imported.rules[0]).toMatchObject({ distance: 'far', nearThreshold: 0.25 });
});

it.each([{ distance: 'medium' }, { nearThreshold: 0.02 }, { nearThreshold: 0.41 }, { nearThreshold: '12%' }])(
  'rejects invalid distance settings %j', fields => {
    const project = makeProject();
    expect(() => parseProject(JSON.stringify({ ...project, rules: [{ ...project.rules[0], ...fields }] }))).toThrow();
  },
);
