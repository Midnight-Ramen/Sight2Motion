import { actionDefinitions, ruleSource, type Action, type Rule } from '../core/types';
import type { SensorDescriptor } from '../core/Sensors';
import { ActionIcon } from './ActionIcon';
const operators = { lessThan: '<', lessThanOrEqual: '≤', greaterThan: '>', greaterThanOrEqual: '≥', equals: '=' };
export const actionCaption = (a: Action) => a.kind === 'move' ? a.mode === 'follow' ? 'Follow' :
  a.direction === 'left' ? 'Turn Left' : a.direction === 'right' ? 'Turn Right' : a.direction === 'backward' ? 'Backward' : 'Forward' : actionDefinitions[a.kind].label;
export function ruleSummary(rule: Rule, sensors: SensorDescriptor[]) {
  const conditions: string[] = [];
  const source = ruleSource(rule);
  if (source !== 'sensor') conditions.push(`${rule.className || 'Choose object'}${rule.region && rule.region !== 'anywhere' ? ` in ${rule.region}` : ''}${rule.distance && rule.distance !== 'any' ? ` (${rule.distance})` : ''}`);
  if (source !== 'vision') conditions.push(...(rule.sensorConditions ?? []).map(c => {
    const sensor = sensors.find(s => s.id === c.sensorId);
    return `${sensor?.label ?? 'Choose sensor'} ${operators[c.operator]} ${c.value}${sensor?.unit ? ` ${sensor.unit}` : ''}`;
  }));
  const trigger = rule.mode === 'disappearance' ? 'When no longer true: ' : '';
  return `${trigger}${conditions.join(' AND ') || 'Add a condition'} → ${rule.actions.filter(a => a.enabled).map(actionCaption).join(', ') || 'Add an action'}`;
}
export function RuleSummary({ rule, sensors }: { rule: Rule; sensors: SensorDescriptor[] }) {
  return <div className="rule-summary"><span>{ruleSummary(rule, sensors)}</span><span className="summary-icons" aria-hidden="true">{rule.actions.filter(a => a.enabled).map(a => <ActionIcon key={a.id} action={a} />)}</span></div>;
}
