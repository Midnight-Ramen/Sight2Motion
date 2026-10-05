import { FINCH_SENSORS, HEADING_UNAVAILABLE, finchSensorDescriptor, type FinchSensorType, SENSOR_TYPES, SENSOR_MAX_AGE, sensorDescriptor, type SensorDescriptor, type SensorState } from '../core/Sensors';
export function SensorInputs({ configuration, state, onChange, robotType = 'hummingbird', connected = false }: {
  robotType?: 'finch' | 'hummingbird'; connected?: boolean;
  configuration: SensorDescriptor[]; state: SensorState; onChange: (sensors: SensorDescriptor[]) => void;
}) {
  const finch = robotType === 'finch';
  return <section className="sensor-inputs" aria-label={finch ? 'Finch Sensors' : 'Hummingbird sensor inputs'}>
    <h3>{finch ? 'Finch Sensors' : 'Live inputs'}</h3>
    {finch ? <>
      {!connected && <p>Connect Finch to read its sensors.</p>}
      {Object.entries(FINCH_SENSORS).map(([type, sensor]) => <label key={type}>
        <input type="checkbox" checked={configuration.some(s => s.type === type)}
          onChange={e => onChange(e.target.checked ? [...configuration, finchSensorDescriptor(type as FinchSensorType)] : configuration.filter(s => s.type !== type))} />
        {sensor.label}
      </label>)}
      <p>Heading: {HEADING_UNAVAILABLE}</p>
    </> : [1, 2, 3].map(port => <label key={port}>Input {port}
      <select aria-label={`Input ${port} sensor`} value={configuration.find(s => s.port === port)?.type ?? ''}
        onChange={e => onChange([...configuration.filter(s => s.port !== port),
          ...(e.target.value ? [sensorDescriptor(e.target.value as keyof typeof SENSOR_TYPES, port)] : [])].sort((a, b) => a.port! - b.port!))}>
        <option value="">None</option>
        {Object.entries(SENSOR_TYPES).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>)}
    <dl>{configuration.map(sensor => {
      const sample = state[sensor.id];
      const reading = sample && performance.now() - sample.updatedAt <= SENSOR_MAX_AGE ? sample.reading : null;
      return <div key={sensor.id}><dt>{sensor.label}</dt><dd>{reading ? reading.kind === 'boolean' ? (reading.value ? 'Pressed' : 'Not pressed') : `${reading.value} ${reading.unit ?? ''}` : finch ? `Waiting for ${sensor.label} data…` : 'Unavailable'}</dd></div>;
    })}</dl>
    {!finch && configuration.some(sensor => !state[sensor.id]?.reading || performance.now() - state[sensor.id].updatedAt > SENSOR_MAX_AGE) &&
      <p role="status">Sensor data is unavailable. Check the sensor connection, port, and selected input type.</p>}
  </section>;
}
