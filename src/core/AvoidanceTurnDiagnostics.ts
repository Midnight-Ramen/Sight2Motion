import { turnRotations } from './FinchGeometry';
import type { EncoderPair } from './EncoderRecording';
import type { AvoidancePhase } from './ObstacleAvoidance';

// Avoidance-only tuning; normal Turn Angle and shared geometry remain unchanged.
export const AVOID_SCAN_ANGLE_DEG = 30;
export const AVOID_BYPASS_ANGLE_DEG = 45;
export const AVOID_TURN_POWER = 20;

export interface AvoidanceTurnSample {
  phase: AvoidancePhase;
  direction: 'left' | 'right';
  requestedAngle: number;
  targetRotations: number;
  actual: [number, number];
  power: number;
  completed: boolean;
}
/** Read-only observer: no timers, polling, motor commands, or calibration changes. */
export class AvoidanceTurnDiagnostics {
  records: AvoidanceTurnSample[] = [];
  private origin?: EncoderPair;
  private current?: AvoidanceTurnSample;
  reset() { this.records = []; this.origin = undefined; this.current = undefined; }
  begin(phase: AvoidancePhase, direction: 'left' | 'right', requestedAngle: number, origin: EncoderPair, power: number) {
    this.current = { phase, direction, requestedAngle, targetRotations: turnRotations(requestedAngle), actual: [0, 0], power, completed: false };
    this.origin = { ...origin };
    this.records.push(this.current);
  }
  update(pair: EncoderPair | null) {
    if (pair && this.origin && this.current) this.current.actual = [pair.left - this.origin.left, pair.right - this.origin.right];
  }
  finish() { if (this.current) this.current.completed = true; }
  // Freeze after post-STOP encoder feedback and before the next segment begins.
  release() { this.current = undefined; this.origin = undefined; }
}
