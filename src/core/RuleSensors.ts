import { FINCH_SENSORS, finchSensorDescriptor, isFinchSensor, sensorDescriptor, SENSOR_TYPES, SENSOR_MAX_AGE, type SensorDescriptor, type SensorState } from './Sensors';
import { ruleSource, type Project } from './types';

export const DERIVED_SENSORS = {
  finchLightLevel: { id: 'finchLightLevel', type: 'light', label: 'Light level', unit: '%' },
  finchWheelMovement: { id: 'finchWheelMovement', type: 'analog', label: 'Wheel movement', unit: 'rotations' },
} as const;
export const isDerivedSensor = (id: string) => Object.hasOwn(DERIVED_SENSORS, id);
export function supportedRuleSensors(robot: Project['robotType']): SensorDescriptor[] {
  return robot === 'finch' ? [finchSensorDescriptor('finchDistance'), ...Object.values(DERIVED_SENSORS),
    finchSensorDescriptor('finchOrientation'), ...Object.keys(FINCH_SENSORS).filter(id => !['finchDistance', 'finchOrientation'].includes(id)).map(id => finchSensorDescriptor(id as keyof typeof FINCH_SENSORS))]
    : [1, 2, 3].flatMap(port => Object.keys(SENSOR_TYPES).map(type => sensorDescriptor(type as keyof typeof SENSOR_TYPES, port)));
}
export function registerRuleSensors(project: Project): Project {
  const supported = supportedRuleSensors(project.robotType);
  const inputs = [...(project.sensorConfiguration ?? [])];
  for (const rule of project.rules) {
    if (ruleSource(rule) === 'vision') continue;
    for (const condition of rule.sensorConditions ?? []) {
      const sensor = supported.find(s => s.id === condition.sensorId);
      if (!sensor || inputs.some(s => s.id === sensor.id)) continue;
      // Hummingbird ports can only have one physical sensor type per port.
      if (sensor.port) inputs.splice(0, inputs.length, ...inputs.filter(s => s.port !== sensor.port));
      inputs.push(sensor);
    }
  }
  return { ...project, sensorConfiguration: inputs };
}
export function pollingSensors(configuration: SensorDescriptor[]): SensorDescriptor[] {
  const inputs = new Map<string, SensorDescriptor>();
  for (const sensor of configuration) {
    const raw = sensor.id === 'finchLightLevel' ? ['finchLightLeft', 'finchLightRight'] : sensor.id === 'finchWheelMovement' ? ['finchEncoderLeft', 'finchEncoderRight'] : [sensor.id];
    for (const id of raw) inputs.set(id, isFinchSensor(id) ? finchSensorDescriptor(id) : sensor);
  }
  return [...inputs.values()];
}
export function derivedSensorState(state: SensorState): SensorState {
  const result = { ...state };
  for (const [id, ids] of [['finchLightLevel', ['finchLightLeft', 'finchLightRight']], ['finchWheelMovement', ['finchEncoderLeft', 'finchEncoderRight']]] as const) {
    const pair = ids.map(raw => state[raw]);
    const valid = pair.every(sample => sample?.reading?.kind === 'number' && Number.isFinite(sample.reading.value));
    const stamps = pair.map(sample => sample?.updatedAt ?? -Infinity);
    const withinPairAge = Math.max(...stamps) - Math.min(...stamps) <= SENSOR_MAX_AGE;
    result[id] = { reading: valid && withinPairAge ? { kind: 'number', value: pair.reduce((sum, sample) => sum + (id === 'finchWheelMovement' ? Math.abs(sample.reading!.value as number) : sample.reading!.value as number), 0) / 2,
      unit: DERIVED_SENSORS[id].unit } : null, updatedAt: Math.min(...stamps) };
  }
  return result;
}
