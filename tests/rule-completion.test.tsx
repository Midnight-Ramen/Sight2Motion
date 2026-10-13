import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { completeRule } from '../src/components/RuleCompletion';
import { ruleSummary } from '../src/components/RuleSummary';
import { RuleCard } from '../src/components/RuleCard';
import { makeRule, makeAction, makeProject, type Rule } from '../src/core/types';
import { ROBOTS } from '../src/core/RobotCapabilities';
import { YOLO_CAPABILITIES } from '../src/core/VisionCapabilities';
import { finchSensorDescriptor } from '../src/core/Sensors';
import { parseProject } from '../src/core/ProjectStorage';
const distance = finchSensorDescriptor('finchDistance');
const complete = (rule = makeRule()) => completeRule(rule, [distance], ['person', 'stop sign', 'red ball'], ROBOTS.finch.actions, YOLO_CAPABILITIES);
it('Done generates the existing summary and requests collapse without changing execution settings', () => {
  const rule = makeRule(), result = complete(rule);
  expect(result.expanded).toBe(false);
  expect(result.rule.name).toBe('Person \u2192 Beak light');
  expect(result.rule.actions).toBe(rule.actions);
  expect(result.rule.mode).toBe(rule.mode);
  expect(result.rule.minDuration).toBe(rule.minDuration);
});
it('re-completing an edited rule refreshes its primary-action title', () => {
  const first = complete().rule;
  const result = complete({ ...first, className: 'stop sign', actions: [makeAction('stop'), makeAction('wait')] });
  expect(result.expanded).toBe(false);
  expect(result.rule.name).toBe('Stop sign \u2192 Stop');
});
it('uses sensor and combined summaries with units and servo parameters', () => {
  const rule = { ...makeRule(), source: 'sensor' as const, sensorConditions: [{ id: 'd', sensorId: 'finchDistance', operator: 'lessThan' as const, value: 20 }], actions: [makeAction('avoidObstacle')] };
  expect(complete(rule).rule.name).toBe('Distance < 20 cm \u2192 Avoid obstacle');
  expect(complete({ ...rule, source: 'vision-sensor', className: 'person', actions: [makeAction('stop')] }).rule.name).toBe('Person + Distance < 20 cm \u2192 Stop');
  const servo = { ...makeRule(), className: 'red ball', actions: [{ ...makeAction('positionServo'), port: 1, angle: 30 }] };
  expect(completeRule(servo, [], ['red ball'], ROBOTS.hummingbird.actions, YOLO_CAPABILITIES).rule.name).toBe('Red ball \u2192 Servo 1: 30\u00b0');
});
it.each([
  [{ ...makeRule(), className: '' }, 'object', 'Choose an object.'],
  [{ ...makeRule(), source: 'sensor' as const, sensorConditions: [] }, 'sensor', 'Choose a sensor condition.'],
  [{ ...makeRule(), actions: [] }, 'action', 'Add at least one action.'],
  [{ ...makeRule(), actions: [{ ...makeAction(), enabled: false }] }, 'action', 'Add at least one action.'],
] satisfies [Rule, string, string][])('incomplete rules stay expanded and report the missing area', (rule, area, message) => {
  const result = complete(rule);
  expect(result.expanded).toBe(true); expect(result.problem).toEqual({ area, message });
  expect(result.rule).toBe(rule);
});
it('old custom names still import safely and remain available outside the primary title', () => {
  const rule = { ...makeRule(), name: 'Our original robot rule' };
  const loaded = parseProject(JSON.stringify({ ...makeProject(), rules: [rule] })).rules[0];
  expect(loaded.name).toBe(rule.name);
  const markup = renderToStaticMarkup(<RuleCard rule={loaded} index={0} selectedClasses={['person']} capabilities={ROBOTS.finch.actions} onChange={() => {}} onDelete={() => {}} />);
  expect(markup).toContain('Saved name'); expect(markup).toContain(rule.name);
  expect(markup).not.toContain('Rule 1 name'); expect(markup).toContain('rule-done');
  expect(ruleSummary(loaded, [], true)).toBe('Person \u2192 Beak light');
});
