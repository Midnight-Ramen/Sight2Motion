import { makeProject, ruleSource, type ActionKind, type Rule } from '../core/types';
import { parseProject } from '../core/ProjectStorage';
import { avoidanceRuleThreshold } from '../core/DrivingReactions';
import { compatibleRule, type VisionCapabilities } from '../core/VisionCapabilities';
import { portsFor } from '../core/RobotCapabilities';
import type { SensorDescriptor } from '../core/Sensors';
import { ruleSummary } from './RuleSummary';
export type CompletionProblem = { area: 'object' | 'sensor' | 'action' | 'settings'; message: string };
export function completeRule(rule: Rule, sensors: SensorDescriptor[], classes: string[], capabilities: ActionKind[], vision: VisionCapabilities) {
  const fail = (area: CompletionProblem['area'], message: string) => ({ expanded: true as const, problem: { area, message }, rule });
  const source = ruleSource(rule);
  if (source !== 'sensor' && (!rule.className.trim() || !classes.includes(rule.className))) return fail('object', 'Choose an object.');
  if (source !== 'vision' && (!rule.sensorConditions?.length || rule.sensorConditions.some(c => !sensors.some(s => s.id === c.sensorId)))) return fail('sensor', 'Choose a sensor condition.');
  const actions = rule.actions.filter(a => a.enabled);
  if (!actions.length) return fail('action', 'Add at least one action.');
  if (actions.some(a => !capabilities.includes(a.kind))) return fail('action', 'Choose an action supported by your robot.');
  if (actions.some(a => portsFor(a.kind).length && !portsFor(a.kind).includes(a.port!))) return fail('action', 'Choose an output port.');
  if (actions.some(a => a.kind === 'avoidObstacle') && avoidanceRuleThreshold([rule]) === undefined) return fail('sensor', 'Choose a Distance less-than condition for Avoid obstacle.');
  if (!compatibleRule(rule, vision)) return fail('settings', 'Update the rule for this vision mode.');
  const name = ruleSummary(rule, sensors, true).slice(0, 100);
  try {
    const referenced = new Set((rule.sensorConditions ?? []).map(c => c.sensorId));
    parseProject(JSON.stringify({ ...makeProject(), robotType: capabilities.includes('positionServo') ? 'hummingbird' : 'finch',
      selectedClasses: classes, sensorConfiguration: sensors.filter(s => referenced.has(s.id)), rules: [{ ...rule, name }] }));
  } catch { return fail('settings', 'Complete the rule settings.'); }
  return { expanded: false as const, problem: undefined, rule: { ...rule, name } };
}
