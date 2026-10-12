import { expect, it } from 'vitest';
import { derivedSensorState, pollingSensors, registerRuleSensors, supportedRuleSensors } from '../src/core/RuleSensors';
import { parseProject } from '../src/core/ProjectStorage';
import { makeProject, makeRule } from '../src/core/types';
import { RuleEngine } from '../src/core/RuleEngine';
import { NumericSensorDisplay } from '../src/components/NumericSensorDisplay';
import { finchSensorDescriptor, type SensorState } from '../src/core/Sensors';

const condition = (id: string) => ({ id, sensorId: id, operator: 'lessThan' as const, value: 40 });
it('registers raw and derived inputs without prerequisites or duplicate raw polling', () => {
  const project = registerRuleSensors({ ...makeProject(), rules: [{ ...makeRule(), source: 'sensor', sensorConditions: [condition('finchLightLevel'), condition('finchLightLeft'), condition('finchWheelMovement')] }] });
  const inputs = pollingSensors(project.sensorConfiguration!);
  expect(inputs.map(s => s.id).sort()).toEqual(['finchEncoderLeft', 'finchEncoderRight', 'finchLightLeft', 'finchLightRight']);
  expect(parseProject(JSON.stringify(project)).sensorConfiguration).toEqual(project.sensorConfiguration);
  expect(supportedRuleSensors('finch').map(s => s.label)).toContain('Wheel movement');
});
it('uses both raw Line conditions and average absolute encoders, retaining raw direction', () => {
  const state: SensorState = Object.fromEntries([['finchLineLeft', 15], ['finchLineRight', 99], ['finchEncoderLeft', -3], ['finchEncoderRight', 1], ['finchLightLeft', 20], ['finchLightRight', 60]].map(([id, value]) => [id, { reading: { kind: 'number', value }, updatedAt: 100 }])) as SensorState;
  const derived = derivedSensorState(state);
  expect(derived.finchWheelMovement.reading?.value).toBe(2);
  expect(derived.finchLightLevel.reading?.value).toBe(40);
  expect(derived.finchEncoderLeft.reading?.value).toBe(-3);
  const rule = { ...makeRule(), source: 'sensor' as const, minDuration: 0, sensorConditions: [condition('finchLineLeft'), condition('finchLineRight')] };
  const engine = new RuleEngine();
  expect(engine.evaluate([rule], [], 100, undefined, { state, configuration: ['finchLineLeft', 'finchLineRight'].map(id => finchSensorDescriptor(id as 'finchLineLeft')), available: true })).toEqual([]);
  state.finchLineRight.reading = { kind: 'number', value: 15 };
  expect(engine.evaluate([rule], [], 101, undefined, { state, configuration: ['finchLineLeft', 'finchLineRight'].map(id => finchSensorDescriptor(id as 'finchLineLeft')), available: true })).toEqual([rule]);
});
it('keeps the oldest pair timestamp so derived inputs cannot bypass stale-data safety', () => {
  const state: SensorState = { finchLightLeft: { reading: { kind: 'number', value: 20 }, updatedAt: 100 }, finchLightRight: { reading: { kind: 'number', value: 60 }, updatedAt: 200 } };
  expect(derivedSensorState(state).finchLightLevel.updatedAt).toBe(100);
  state.finchLightRight.updatedAt = 900;
  expect(derivedSensorState(state).finchLightLevel.reading).toBeNull();
});
it('retains numeric values through unavailable/string readings and clears on reset', () => {
  const display = new NumericSensorDisplay();
  expect(display.value('distance')).toBe('—');
  display.update({ distance: { reading: { kind: 'number', value: 37 }, updatedAt: 0 } });
  display.update({ distance: { reading: null, updatedAt: 1 } });
  display.update({ distance: { reading: { kind: 'string', value: 'Reading...' }, updatedAt: 2 } });
  expect(display.value('distance')).toBe('37');
  display.update({ distance: { reading: { kind: 'number', value: 41 }, updatedAt: 3 } });
  expect(display.value('distance')).toBe('41');
  display.reset(); expect(display.value('distance')).toBe('—');
  display.reset(100);
  display.update({ distance: { reading: { kind: 'number', value: 37 }, updatedAt: 99 } });
  expect(display.value('distance')).toBe('—');
});
