import { expect, it, vi } from 'vitest';
import { avoidanceRuleThreshold, engineRules, drivingOverride } from '../src/core/DrivingReactions';
import { makeProject, makeRule, makeAction, type Rule } from '../src/core/types';
import { registerRuleSensors } from '../src/core/RuleSensors';
import { RuleEngine } from '../src/core/RuleEngine';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import type { ActionEngine } from '../src/core/ActionEngine';
import { parseProject } from '../src/core/ProjectStorage';
import { setupReadiness } from '../src/core/SetupReadiness';
import { RuleCard } from '../src/components/RuleCard';
import { ROBOTS } from '../src/core/RobotCapabilities';
import { renderToStaticMarkup } from 'react-dom/server';
const avoidanceRule = (value = 20): Rule => ({ ...makeRule(), source: 'sensor', minDuration: 0,
  sensorConditions: [{ id: 'distance', sensorId: 'finchDistance', operator: 'lessThan', value }],
  actions: [makeAction('avoidObstacle')] });
it('Distance conditions supply the only avoidance threshold', () => {
  const rule = avoidanceRule(25);
  expect(avoidanceRuleThreshold([rule])).toBe(25);
  rule.sensorConditions![0].value = 35;
  expect(avoidanceRuleThreshold([rule])).toBe(35);
  expect(engineRules([rule])).toEqual([]); expect(drivingOverride([rule], [])).toBeUndefined();
});
it('preserves strict threshold qualification and registers Distance automatically', async () => {
  const project = registerRuleSensors({ ...makeProject(), rules: [avoidanceRule()] });
  expect(project.sensorConfiguration?.filter(input => input.id === 'finchDistance')).toHaveLength(1);
  const rules = new RuleEngine();
  const evaluate = (value: number) => rules.evaluate(project.rules, [], 100, undefined,
    { available: true, configuration: project.sensorConfiguration!, state: { finchDistance: { reading: { kind: 'number', value }, updatedAt: 100 } } });
  expect(evaluate(20)).toEqual([]); expect(rules.activeRules).toEqual([]);
  const triggered = evaluate(19);
  expect(triggered).toHaveLength(1);
  const engine = { busy: false, updateRules: vi.fn(async () => true), stop: vi.fn(async () => {}) };
  const coordinator = new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
  let threshold: number | undefined;
  const run = vi.fn(async () => true);
  coordinator.assist = { shouldTrigger: (_triggered, active) => { threshold = avoidanceRuleThreshold(active); return threshold !== undefined; }, run, cancel: vi.fn(), reset: vi.fn() };
  coordinator.arm({ safe: () => true, start: async () => true, suspend: () => {} });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await coordinator.update(triggered, rules.activeRules);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(threshold).toBe(20); expect(run).toHaveBeenCalledTimes(1);
});
it('supports Vision + Sensor and ignores disabled or invalid avoidance conditions', () => {
  expect(avoidanceRuleThreshold([{ ...avoidanceRule(), source: 'vision-sensor' }])).toBe(20);
  expect(avoidanceRuleThreshold([{ ...avoidanceRule(), enabled: false }])).toBeUndefined();
  expect(avoidanceRuleThreshold([{ ...avoidanceRule(), source: 'vision' }])).toBeUndefined();
  expect(avoidanceRuleThreshold([avoidanceRule(0)])).toBeUndefined();
  expect(avoidanceRuleThreshold([{ ...avoidanceRule(), sensorConditions: [] }])).toBeUndefined();
});
it('saved action remains compatible and rejects unsupported robot use', () => {
  const project = { ...makeProject(), rules: [avoidanceRule()] };
  expect(parseProject(JSON.stringify(project)).rules[0].actions[0].kind).toBe('avoidObstacle');
  expect(() => parseProject(JSON.stringify({ ...project, robotType: 'hummingbird' }))).toThrow();
});
it('requires an appropriate distance condition without duplicating an action threshold', () => {
  const project = { ...makeProject(), rules: [{ ...avoidanceRule(), sensorConditions: [] }] };
  const readiness = setupReadiness(project, { usableFrame: false, modelReady: false, classes: [], connected: true, hardwareBusy: false, running: false, demo: false });
  expect(readiness.play).toBe(false); expect(readiness.helper).toContain('Distance less-than');
  const markup = renderToStaticMarkup(<RuleCard rule={avoidanceRule()} index={0} selectedClasses={[]} capabilities={ROBOTS.finch.actions} onChange={() => {}} onDelete={() => {}} />);
  expect(markup).toContain('Avoid obstacle'); expect(markup).toContain('Uses this rule');
  expect(markup).not.toContain('Detect within');
});
