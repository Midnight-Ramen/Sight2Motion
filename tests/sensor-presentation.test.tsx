import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SensorInputs } from '../src/components/SensorInputs';
import { lightLevelDisplay, SENSOR_GROUPS } from '../src/components/SensorPresentation';
import { finchSensorDescriptor, type SensorState } from '../src/core/Sensors';

const state: SensorState = {
  finchLightLeft: { reading: { kind: 'number', value: 20 }, updatedAt: 100 },
  finchLightRight: { reading: { kind: 'number', value: 61 }, updatedAt: 100 },
};
it('derives the light average only from two fresh numeric readings', () => {
  expect(lightLevelDisplay(state, 100)).toBe('40.5 %');
  expect(lightLevelDisplay(state, 850)).toBe('40.5 %');
  expect(lightLevelDisplay(state, 851)).toBeNull();
  expect(lightLevelDisplay(state, 99)).toBeNull();
  expect(lightLevelDisplay({ finchLightLeft: state.finchLightLeft }, 100)).toBeNull();
  expect(lightLevelDisplay({ ...state, finchLightRight: { reading: null, updatedAt: 100 } }, 100)).toBeNull();
  expect(state.finchLightLeft.reading?.value).toBe(20);
});
it('presents five groups and retains individual sensors in advanced disclosure', () => {
  const configuration = SENSOR_GROUPS.flatMap(group => group.types.map(finchSensorDescriptor));
  const html = renderToStaticMarkup(<SensorInputs robotType="finch" configuration={configuration} state={{}} onChange={() => {}} />);
  for (const group of SENSOR_GROUPS) expect(html).toContain(group.label);
  expect(html).toContain('<summary>Advanced sensors</summary>');
  for (const sensor of configuration.filter(sensor => !['finchDistance', 'finchOrientation'].includes(sensor.type))) {
    expect(html.slice(html.indexOf('<details'))).toContain(sensor.label);
  }
  expect(html.match(/type="checkbox"/g)).toHaveLength(11);
});
