import { SENSOR_MAX_AGE, type FinchSensorType, type SensorState } from '../core/Sensors';

export const SENSOR_GROUPS: { label: string; types: FinchSensorType[] }[] = [
  { label: 'Distance', types: ['finchDistance'] },
  { label: 'Line', types: ['finchLineLeft', 'finchLineRight'] },
  { label: 'Light level', types: ['finchLightLeft', 'finchLightRight'] },
  { label: 'Orientation', types: ['finchOrientation'] },
  { label: 'Wheel movement', types: ['finchEncoderLeft', 'finchEncoderRight'] },
];

export function sensorDisplay(state: SensorState, id: string, now: number): string | null {
  const sample = state[id];
  if (!sample?.reading || now < sample.updatedAt || now - sample.updatedAt > SENSOR_MAX_AGE) return null;
  const reading = sample.reading;
  return reading.kind === 'boolean' ? (reading.value ? 'Pressed' : 'Not pressed') : `${reading.value} ${reading.unit ?? ''}`.trim();
}

// Presentation only: rules, polling and saved projects continue to use raw sensor IDs.
export function lightLevelDisplay(state: SensorState, now: number): string | null {
  const pair = ['finchLightLeft', 'finchLightRight'].map(id => state[id]);
  if (pair.some(sample => !sample?.reading || sample.reading.kind !== 'number' ||
    !Number.isFinite(sample.reading.value) || now < sample.updatedAt || now - sample.updatedAt > SENSOR_MAX_AGE)) return null;
  const values = pair.map(sample => sample.reading!.value as number);
  return `${Number(((values[0] + values[1]) / 2).toFixed(1))} %`;
}
