import { useRef } from 'react';
import { NumericSensorDisplay } from './NumericSensorDisplay';
import { SENSOR_GROUPS } from './SensorPresentation';
import { FINCH_SENSORS, HEADING_UNAVAILABLE, finchSensorDescriptor, type FinchSensorType, SENSOR_TYPES, SENSOR_MAX_AGE, sensorDescriptor, type SensorDescriptor, type SensorState } from '../core/Sensors';
export function SensorInputs({ configuration, state, onChange, resetKey, robotType = 'hummingbird', connected = false }: {
  resetKey?: string;
  robotType?: 'finch' | 'hummingbird'; connected?: boolean;
  configuration: SensorDescriptor[]; state: SensorState; onChange: (sensors: SensorDescriptor[]) => void;
}) {
  const cache = useRef(new NumericSensorDisplay());
  const previousReset = useRef(resetKey);
  if (!connected || previousReset.current !== resetKey) cache.current.reset(performance.now());
  previousReset.current = resetKey;
  if (connected) cache.current.update(state);
  const finch = robotType === 'finch';
  return <section className="sensor-inputs" aria-label={finch ? 'Finch Sensors' : 'Hummingbird sensor inputs'}>
    <h3>{finch ? 'Finch Sensors' : 'Live inputs'}</h3>
    {finch ? <>
      {!connected && <p>Connect Finch to read its sensors.</p>}
      {SENSOR_GROUPS.map(group => {
        const checked = group.types.every(type => configuration.some(sensor => sensor.type === type));
        const partial = !checked && group.types.some(type => configuration.some(sensor => sensor.type === type));
        const display = group.label === 'Light level' ? cache.current.average(group.types)
          : group.label === 'Wheel movement' ? cache.current.average(group.types, true)
          : group.types.map(type => cache.current.value(type)).join(' / ');
        return <div className="sensor-group" key={group.label}>
          <label><input type="checkbox" checked={checked} ref={input => { if (input) input.indeterminate = partial; }}
            onChange={event => onChange(event.target.checked
              ? [...configuration, ...group.types.filter(type => !configuration.some(sensor => sensor.type === type)).map(finchSensorDescriptor)]
              : configuration.filter(sensor => !group.types.some(type => type === sensor.type)))} />{group.label}</label>
          <span>{display}</span>
        </div>;
      })}
      <details className="advanced-sensors"><summary>Advanced sensors</summary>
        <p>Individual readings and rule inputs. Paired groups use both sensors.</p>
        {Object.entries(FINCH_SENSORS).filter(([type]) => !['finchDistance', 'finchOrientation'].includes(type)).map(([type, sensor]) => <div className="sensor-group" key={type}>
          <label><input type="checkbox" checked={configuration.some(s => s.type === type)}
            onChange={e => onChange(e.target.checked ? [...configuration, finchSensorDescriptor(type as FinchSensorType)] : configuration.filter(s => s.type !== type))} />{sensor.label}</label>
          <span>{cache.current.value(type)}</span>
        </div>)}
      </details>
      <p>Heading: {HEADING_UNAVAILABLE}</p>
    </> : [1, 2, 3].map(port => <label key={port}>Input {port}
      <select aria-label={`Input ${port} sensor`} value={configuration.find(s => s.port === port)?.type ?? ''}
        onChange={e => onChange([...configuration.filter(s => s.port !== port),
          ...(e.target.value ? [sensorDescriptor(e.target.value as keyof typeof SENSOR_TYPES, port)] : [])].sort((a, b) => a.port! - b.port!))}>
        <option value="">None</option>
        {Object.entries(SENSOR_TYPES).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>)}
    {!finch && <dl>{configuration.map(sensor => {
      return <div key={sensor.id}><dt>{sensor.label}</dt><dd>{cache.current.value(sensor.id)}</dd></div>;
    })}</dl>}
    {!finch && configuration.some(sensor => !state[sensor.id]?.reading || performance.now() - state[sensor.id].updatedAt > SENSOR_MAX_AGE) &&
      <p role="status">Sensor data is unavailable. Check the sensor connection, port, and selected input type.</p>}
  </section>;
}
