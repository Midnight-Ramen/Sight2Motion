export type SensorType = 'distance' | 'light' | 'sound' | 'analog' | 'digital';
export type SensorValue = { kind: 'number'; value: number; unit?: string } | { kind: 'boolean'; value: boolean };
export interface SensorDescriptor { id: string; type: SensorType; port: number; label: string; unit?: string }
export interface SensorCondition {
  id: string; sensorId: string;
  operator: 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'equals';
  value: number | boolean;
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
  if (reading.kind === 'boolean') return condition.operator === 'equals' && reading.value === condition.value;
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
