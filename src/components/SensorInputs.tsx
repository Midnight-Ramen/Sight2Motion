import { SENSOR_TYPES, SENSOR_MAX_AGE, sensorDescriptor, type SensorDescriptor, type SensorState } from '../core/Sensors';
export function SensorInputs({ configuration, state, onChange }: {
  configuration: SensorDescriptor[]; state: SensorState; onChange: (sensors: SensorDescriptor[]) => void;
}) {
  return <section className="sensor-inputs" aria-label="Hummingbird sensor inputs">
    <h3>Live inputs</h3>
    {[1, 2, 3].map(port => <label key={port}>Input {port}
      <select aria-label={`Input ${port} sensor`} value={configuration.find(s => s.port === port)?.type ?? ''}
        onChange={e => onChange([...configuration.filter(s => s.port !== port),
          ...(e.target.value ? [sensorDescriptor(e.target.value as keyof typeof SENSOR_TYPES, port)] : [])].sort((a, b) => a.port - b.port))}>
        <option value="">None</option>
        {Object.entries(SENSOR_TYPES).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>)}
    <dl>{configuration.map(sensor => {
      const sample = state[sensor.id];
      const reading = sample && performance.now() - sample.updatedAt <= SENSOR_MAX_AGE ? sample.reading : null;
      return <div key={sensor.id}><dt>{sensor.label}</dt><dd>{reading ? reading.kind === 'boolean' ? (reading.value ? 'Pressed' : 'Not pressed') : `${reading.value} ${reading.unit ?? ''}` : 'Unavailable'}</dd></div>;
    })}</dl>
    {configuration.some(sensor => !state[sensor.id]?.reading || performance.now() - state[sensor.id].updatedAt > SENSOR_MAX_AGE) &&
      <p>Check the sensor connection and selected input type.</p>}
  </section>;
}
