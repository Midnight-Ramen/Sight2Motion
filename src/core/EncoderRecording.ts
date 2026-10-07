import { SENSOR_MAX_AGE, type SensorState } from './Sensors';
import type { Action } from './types';
export type EncoderPair = { left: number; right: number };
export function encoderPair(state: SensorState, now: number): EncoderPair | null {
 const samples = [state.finchEncoderLeft, state.finchEncoderRight];
 if (samples.some(s => !s || s.reading?.kind !== 'number' || !Number.isFinite(s.reading.value) || now < s.updatedAt || now - s.updatedAt > SENSOR_MAX_AGE)) return null;
 return { left: samples[0].reading!.value as number, right: samples[1].reading!.value as number };
}
export interface RecordedSegment { direction: Action['direction']; start: EncoderPair; end: EncoderPair; delta: EncoderPair }
/** Session-only observer. No transport, timers, motor commands or project persistence. */
export class EncoderRecording {
 origin: EncoderPair | null = null;
 segments: RecordedSegment[] = [];
 private active: RecordedSegment | null = null;
 clear() { this.origin = null; this.segments = []; this.active = null; }
 setHome(pair: EncoderPair | null) { if (!pair) return false; this.clear(); this.origin = { ...pair }; return true; }
 relative(pair: EncoderPair | null): EncoderPair | null {
  return pair && this.origin ? { left: pair.left-this.origin.left, right: pair.right-this.origin.right } : null;
 }
 begin(direction: Action['direction'], pair: EncoderPair | null) {
  if (this.active?.direction === direction) return;
  this.active = null;
  const start = this.relative(pair); if (!start) return;
  this.active = { direction, start, end: { ...start }, delta: { left: 0, right: 0 } };
  this.segments.push(this.active);
 }
 observe(pair: EncoderPair | null) {
  if (!pair) { this.active = null; return; } // Never bridge an unobserved gap.
  const end = this.relative(pair); if (!end || !this.active) return;
  this.active.end = end;
  this.active.delta = { left: end.left-this.active.start.left, right: end.right-this.active.start.right };
 }
 stop(pair: EncoderPair | null) { this.observe(pair); this.active = null; }
}
