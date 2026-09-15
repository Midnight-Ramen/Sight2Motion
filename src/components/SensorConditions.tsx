import { SENSOR_OPERATORS, type SensorCondition, type SensorDescriptor } from '../core/Sensors';
export function SensorConditions({ conditions, sensors, available, onChange }: {
  conditions: SensorCondition[]; sensors: SensorDescriptor[]; available: boolean; onChange: (conditions: SensorCondition[]) => void;
}) {
  if (!available) return conditions.length ? <small role="status">Sensor conditions: Not available for Finch</small> : null;
  const patch = (id: string, update: Partial<SensorCondition>) => onChange(conditions.map(c => c.id === id ? { ...c, ...update } : c));
  return <div className="sensor-conditions">
    {conditions.map((condition, i) => {
      const sensor = sensors.find(s => s.id === condition.sensorId);
      return <div className="sensor-condition" key={condition.id}>
        <strong>AND</strong>
        <select aria-label={`Sensor condition ${i + 1} input`} value={sensor ? condition.sensorId : ''}
          onChange={e => patch(condition.id, { sensorId: e.target.value, value: 20 })}>
          {!sensor && <option value="" disabled>Input unavailable</option>}
          {sensors.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label={`Sensor condition ${i + 1} operator`} value={condition.operator}
          onChange={e => patch(condition.id, { operator: e.target.value as SensorCondition['operator'] })}>
          {Object.entries(SENSOR_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" aria-label={`Sensor condition ${i + 1} value`} value={typeof condition.value === 'number' ? condition.value : 0}
          onChange={e => patch(condition.id, { value: Number(e.target.value) })} />
        <span>{sensor?.unit}</span>
        <button aria-label={`Remove sensor condition ${i + 1}`} onClick={() => onChange(conditions.filter(c => c.id !== condition.id))}>×</button>
      </div>;
    })}
    <button disabled={!sensors.length || conditions.length >= 10} onClick={() => onChange([...conditions,
      { id: crypto.randomUUID(), sensorId: sensors[0].id, operator: 'lessThan', value: 20 }])}>+ Add sensor condition</button>
    {!sensors.length && <small>Configure an input in the robot panel first.</small>}
  </div>;
}
