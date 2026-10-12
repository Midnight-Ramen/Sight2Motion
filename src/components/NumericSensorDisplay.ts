import type { SensorState } from '../core/Sensors';
/** Display cache only. Rule evaluation continues to require fresh sensor data. */
export class NumericSensorDisplay {
  private values: Record<string, number> = {};
  private after = -Infinity;
  reset(after = -Infinity) { this.values = {}; this.after = after; }
  update(state: SensorState) {
    for (const [id, sample] of Object.entries(state)) {
      if (sample.updatedAt >= this.after && sample.reading?.kind === 'number' && Number.isFinite(sample.reading.value)) this.values[id] = sample.reading.value;
    }
  }
  value(id: string): string { return this.values[id] === undefined ? '—' : String(Number(this.values[id].toFixed(2))); }
  average(ids: string[], absolute = false): string {
    if (ids.some(id => this.values[id] === undefined)) return '—';
    return String(Number((ids.reduce((sum, id) => sum + (absolute ? Math.abs(this.values[id]) : this.values[id]), 0) / ids.length).toFixed(2)));
  }
}
