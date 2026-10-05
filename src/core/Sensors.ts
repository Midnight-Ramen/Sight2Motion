export const FINCH_SENSORS = {
  finchDistance: { label: 'Distance', path: 'Distance/static', unit: 'cm' },
  finchLineLeft: { label: 'Left Line', path: 'Line/Left', unit: '' },
  finchLineRight: { label: 'Right Line', path: 'Line/Right', unit: '' },
  finchLightLeft: { label: 'Left Light', path: 'Light/Left', unit: '%' },
  finchLightRight: { label: 'Right Light', path: 'Light/Right', unit: '%' },
  finchEncoderLeft: { label: 'Left Encoder', path: 'Encoder/Left', unit: 'rotations' },
  finchEncoderRight: { label: 'Right Encoder', path: 'Encoder/Right', unit: 'rotations' },
  finchOrientation: { label: 'Orientation', path: 'finchOrientation', unit: '' },
} as const;
export type FinchSensorType = keyof typeof FINCH_SENSORS;
export const isFinchSensor = (type: string): type is FinchSensorType => Object.hasOwn(FINCH_SENSORS, type);
export const FINCH_ORIENTATIONS = ['Beak Up', 'Beak Down', 'Tilt Left', 'Tilt Right', 'Level', 'Upside Down', 'In between'] as const;
export const HEADING_UNAVAILABLE = 'No data — calibration status unavailable';
// Verified /hummingbird/in/finchCompass/static/{slot} has no verified validity signal. Do not poll or offer it in rules.
export function finchSensorDescriptor(type: FinchSensorType): SensorDescriptor {
  return { id: type, type, label: FINCH_SENSORS[type].label, unit: FINCH_SENSORS[type].unit };
}
export type SensorType = 'distance' | 'light' | 'sound' | 'analog' | 'digital' | FinchSensorType;
export type SensorValue = { kind: 'number'; value: number; unit?: string } | { kind: 'boolean'; value: boolean } | { kind: 'string'; value: string; unit?: never };
export interface SensorDescriptor { id: string; type: SensorType; port?: number; label: string; unit?: string }
export interface SensorCondition {
  id: string; sensorId: string;
  operator: 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'equals';
  value: number | boolean | string;
}
export type SensorState = Record<string, { reading: SensorValue | null; updatedAt: number }>;
export const SENSOR_MAX_AGE = 750;
export const SENSOR_TYPES = { distance: 'Distance', light: 'Light', sound: 'Sound', analog: 'Generic analog' } as const;
export const SENSOR_OPERATORS = { lessThan: 'Less than', lessThanOrEqual: 'Less than or equal to', greaterThan: 'Greater than', greaterThanOrEqual: 'Greater than or equal to', equals: 'Equals' } as const;
export function sensorDescriptor(type: keyof typeof SENSOR_TYPES, port: number): SensorDescriptor {
  return { id: `${type}:${port}`, type, port, label: `${SENSOR_TYPES[type]} ${port}`, unit: type === 'distance' ? 'cm' : '%' };
}
// BirdBrain reference client scaling; generic analog is percentage of the full byte range.
export function normalizeSensor(type: SensorType, raw: string): SensorValue | null {
  if (isFinchSensor(type)) {
    if (type === 'finchOrientation') return FINCH_ORIENTATIONS.includes(raw as typeof FINCH_ORIENTATIONS[number]) ? { kind: 'string', value: raw } : null;
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || (!type.startsWith('finchEncoder') && value < 0) ||
      ((type.startsWith('finchLine') || type.startsWith('finchLight')) && value > 100)) return null;
    return { kind: 'number', value, unit: FINCH_SENSORS[type].unit };
  }
  if (type === 'digital') return raw === 'true' || raw === 'false' ? { kind: 'boolean', value: raw === 'true' } : null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  if (value > 255) return null;
  const factor = type === 'distance' ? 1.17 : type === 'sound' ? 200 / 255 : 100 / 255;
  return { kind: 'number', value: Math.min(type === 'distance' ? Infinity : 100, Math.trunc(value * factor)), unit: type === 'distance' ? 'cm' : '%' };
}
export function sensorMatches(condition: SensorCondition, state: SensorState, now: number): boolean {
  const sample = state[condition.sensorId];
  if (!sample?.reading || now - sample.updatedAt > SENSOR_MAX_AGE || now < sample.updatedAt) return false;
  const reading = sample.reading;
  if (typeof reading.value !== typeof condition.value) return false;
  if (reading.kind !== 'number') return condition.operator === 'equals' && reading.value === condition.value;
  const target = condition.value as number;
  if (!Number.isFinite(reading.value) || !Number.isFinite(target)) return false;
  switch (condition.operator) {
    case 'lessThan': return reading.value < target;
    case 'lessThanOrEqual': return reading.value <= target;
    case 'greaterThan': return reading.value > target;
    case 'greaterThanOrEqual': return reading.value >= target;
    case 'equals': return reading.value === target;
  }
}
