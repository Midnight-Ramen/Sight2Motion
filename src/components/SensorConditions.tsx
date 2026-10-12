import { FINCH_ORIENTATIONS, SENSOR_OPERATORS, type SensorCondition, type SensorDescriptor } from '../core/Sensors';
export function SensorConditions({ conditions, sensors, available, onChange, sensorOnly = false }: {
  sensorOnly?: boolean;
  conditions: SensorCondition[]; sensors: SensorDescriptor[]; available: boolean; onChange: (conditions: SensorCondition[]) => void;
}) {
  if (!available) return conditions.length ? <small role="status">Sensor conditions unavailable</small> : null;
  const patch = (id: string, update: Partial<SensorCondition>) => onChange(conditions.map(c => c.id === id ? { ...c, ...update } : c));
  const paired = (id: string) => conditions.find(c => c.id === `${id}-paired-line`);
  const updateCondition = (condition: SensorCondition, update: Partial<SensorCondition>) => {
    const pair = paired(condition.id);
    onChange(conditions.map(c => c.id === condition.id || c.id === pair?.id ? { ...c, ...update } : c));
  };
  return <div className="sensor-conditions">
    {conditions.filter(c => !conditions.some(left => c.id === `${left.id}-paired-line`)).map((condition, i) => {
      const sensor = sensors.find(s => s.id === condition.sensorId);
      const pair = paired(condition.id);
      return <div className="sensor-condition" key={condition.id}>
        <strong>{sensorOnly && i === 0 ? 'IF' : 'AND'}</strong>
        <select aria-label={`Sensor condition ${i + 1} input`} value={pair ? 'finchLine' : sensor ? condition.sensorId : ''}
          onChange={e => {
            const line = e.target.value === 'finchLine';
            const updated = { ...condition, sensorId: line ? 'finchLineLeft' : e.target.value, operator: e.target.value === 'finchOrientation' ? 'equals' as const : 'lessThan' as const, value: e.target.value === 'finchOrientation' ? 'Level' : 20 };
            onChange([...conditions.filter(c => c.id !== pair?.id).map(c => c.id === condition.id ? updated : c),
              ...(line ? [{ ...updated, id: `${condition.id}-paired-line`, sensorId: 'finchLineRight' }] : [])]);
          }}>
          {!sensor && <option value="" disabled>Input unavailable</option>}
          {sensors.some(s => s.id === 'finchLineLeft') ? <>
            <option value="finchDistance">Distance</option>
            <option value="finchLine" disabled={!pair && conditions.length >= 10}>Line</option>
            {['finchLightLevel', 'finchOrientation', 'finchWheelMovement'].map(id => sensors.find(s => s.id === id)).filter((s): s is SensorDescriptor => !!s).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </> : sensors.filter(s => !/^finch(Line|Light|Encoder)/.test(s.type)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          <optgroup label="Advanced sensors">{sensors.filter(s => /^finch(Line|Light|Encoder)/.test(s.type)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>
        </select>
        <select aria-label={`Sensor condition ${i + 1} operator`} value={condition.operator}
          onChange={e => updateCondition(condition, { operator: e.target.value as SensorCondition['operator'] })}>
          {Object.entries(SENSOR_OPERATORS).filter(([value]) => sensor?.type !== 'finchOrientation' || value === 'equals').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {sensor?.type === 'finchOrientation' ? <select aria-label={`Sensor condition ${i + 1} value`} value={String(condition.value)}
          onChange={e => patch(condition.id, { value: e.target.value })}>
          {FINCH_ORIENTATIONS.map(value => <option key={value}>{value}</option>)}
        </select> : <input type="number" aria-label={`Sensor condition ${i + 1} value`} value={typeof condition.value === 'number' ? condition.value : 0}
          onChange={e => updateCondition(condition, { value: Number(e.target.value) })} />}
        <span>{sensor?.unit}</span>
        {pair && <small>Both line sensors must match.</small>}
        <button aria-label={`Remove sensor condition ${i + 1}`} onClick={() => onChange(conditions.filter(c => c.id !== condition.id && c.id !== pair?.id))}>×</button>
      </div>;
    })}
    <button disabled={!sensors.length || conditions.length >= 10} onClick={() => onChange([...conditions,
      { id: crypto.randomUUID(), sensorId: sensors[0].id, operator: sensors[0].type === 'finchOrientation' ? 'equals' : 'lessThan', value: sensors[0].type === 'finchOrientation' ? 'Level' : 20 }])}>+ Add sensor condition</button>
    {!sensors.length && <small>No sensors supported by this robot.</small>}
  </div>;
}
