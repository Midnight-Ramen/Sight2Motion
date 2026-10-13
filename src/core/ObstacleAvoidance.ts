import { AVOID_SCAN_ANGLE_DEG, AVOID_BYPASS_ANGLE_DEG, AVOID_TURN_POWER } from './AvoidanceTurnDiagnostics';
import { freshDistance, type NavigationCommand } from './FinchNavigation';
import { SENSOR_MAX_AGE, type SensorState } from './Sensors';

export const OBSTACLE_AVOIDANCE = {
  scanAngle: AVOID_SCAN_ANGLE_DEG, avoidanceTurn: AVOID_BYPASS_ANGLE_DEG, minimumTurnSpeed: AVOID_TURN_POWER, bypassDistanceCm: 25, passingDistanceCm: 30, hysteresisCm: 3, rearmClearanceCm: 5, rearmMs: 500, freshReadingTimeoutMs: 2500,
} as const;
export type AvoidancePhase = 'IDLE' | 'STOPPING' | 'SCAN_LEFT_TURN' | 'SCAN_LEFT_SAMPLE' | 'SCAN_RIGHT_TURN' | 'SCAN_RIGHT_SAMPLE' | 'RETURN_CENTER' | 'CHOOSE_SIDE' | 'BYPASS_TURN' | 'BYPASS_DRIVE' | 'REALIGN' | 'PASS_DRIVE' | 'RETURN_TURN' | 'RETURN_DRIVE' | 'FINAL_REALIGN' | 'COMPLETE' | 'ABORTED';
export interface AvoidanceDependencies {
  sensors: () => SensorState;
  allowed: () => boolean;
  unsafe?: (forward: boolean) => string | undefined;
  phaseChanged?: (phase: AvoidancePhase, reason?: string) => void;
  stop: () => Promise<void>;
  move: (command: NavigationCommand, signal: AbortSignal) => Promise<boolean>;
  status: (message: string) => void;
  now?: () => number;
}
/** Sequencing only. Navigation owns calibrated movement and the existing provider publishes readings. */
export class ObstacleAvoidance {
  phase: AvoidancePhase = 'IDLE';
  abortReason?: string;
  failedPhase?: AvoidancePhase;
  private translating = false;
  get movingForward() { return this.translating; }
  private enter(phase: AvoidancePhase, reason?: string) { if (phase === 'ABORTED' && this.phase !== 'ABORTED') this.failedPhase = this.phase;
    if (phase === 'IDLE' || phase === 'STOPPING') this.failedPhase = undefined;
    this.phase = phase; this.abortReason = reason; this.deps.phaseChanged?.(phase, reason); }
  private check(signal: AbortSignal) {
    if (signal.aborted) throw new Error(this.abortReason ?? 'cancelled');
    if (!this.deps.allowed()) throw new Error('disconnect or global safety');
    const reason = this.deps.unsafe?.(this.translating); if (reason) throw new Error(reason);
  }
  private abort?: AbortController;
  private latched = false;
  private clearSince?: number;
  private lastClearSample?: number;
  private waiting?: { after: number; resolve: (distance: number) => void; reject: () => void };
  constructor(private deps: AvoidanceDependencies, public threshold = 20,
    private config: Readonly<{ scanAngle: number; avoidanceTurn: number; bypassDistanceCm: number; passingDistanceCm: number; hysteresisCm: number; rearmClearanceCm: number; rearmMs: number; freshReadingTimeoutMs: number }> = OBSTACLE_AVOIDANCE) {}
  private now() { return this.deps.now?.() ?? performance.now(); }
  get active() { return !!this.abort; }
  reset() { this.cancel(); this.latched = false; this.clearSince = undefined; this.lastClearSample = undefined; this.enter('IDLE'); }
  cancel(reason = 'STOP/manual takeover/disconnect') { if (this.abort) this.enter('ABORTED', reason); this.abort?.abort(); this.abort = undefined; this.waiting?.reject(); this.waiting = undefined; }
  shouldTrigger() {
    const distance = freshDistance(this.deps.sensors(), this.now());
    if (!this.active && this.latched) {
      const stamp = this.deps.sensors().finchDistance?.updatedAt;
      if (distance === null || distance <= this.threshold + this.config.rearmClearanceCm || stamp === undefined) {
        this.clearSince = undefined; this.lastClearSample = undefined;
      } else {
        if (this.lastClearSample !== undefined && stamp - this.lastClearSample > SENSOR_MAX_AGE) this.clearSince = undefined;
        this.clearSince ??= this.now();
        this.lastClearSample = stamp;
        if (this.now() - this.clearSince >= this.config.rearmMs && stamp > this.clearSince) this.latched = false;
      }
    }
    return !this.active && !this.latched && distance !== null && distance <= this.threshold;
  }
  sensorsUpdated() {
    if (this.abort) { try { this.check(this.abort.signal); } catch (error) { this.cancel(error instanceof Error ? error.message : 'safety abort'); void this.deps.stop(); return; } }
    const waiter = this.waiting, state = this.deps.sensors();
    const distance = freshDistance(state, this.now());
    if (waiter && distance !== null && state.finchDistance.updatedAt > waiter.after) waiter.resolve(distance);
  }
  private read(after: number, signal: AbortSignal): Promise<number> {
    return new Promise((resolve, reject) => {
      const fail = () => { clean(); reject(new Error(signal.aborted ? this.abortReason ?? 'cancelled' : `stale distance: no new sample during ${this.phase}`)); };
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', fail); this.waiting = undefined; };
      const timer = setTimeout(fail, this.config.freshReadingTimeoutMs);
      this.waiting = { after, resolve: value => { clean(); resolve(value); }, reject: fail };
      signal.addEventListener('abort', fail, { once: true });
      if (signal.aborted) fail(); else this.sensorsUpdated();
    });
  }
  async run(): Promise<boolean> {
    if (this.active || !this.deps.allowed()) return false;
    const abort = new AbortController(); this.abort = abort; this.latched = true; this.clearSince = undefined; this.lastClearSample = undefined;
    const check = () => this.check(abort.signal);
    const move = async (command: NavigationCommand) => {
      this.translating = command.kind === 'distance' && command.direction === 'forward';
      try { check(); if (!await this.deps.move(command, abort.signal)) throw new Error('navigation failed'); check(); }
      finally { this.translating = false; }
    };
    const turn = (direction: 'left' | 'right', amount: number) => move({ kind: 'turn', direction, amount });
    try {
      this.enter('STOPPING'); this.deps.status('Avoiding obstacle'); await this.deps.stop(); check();
      this.enter('SCAN_LEFT_TURN'); this.deps.status('Scanning left'); await turn('left', this.config.scanAngle);
      this.enter('SCAN_LEFT_SAMPLE'); const left = await this.read(this.now(), abort.signal); check();
      this.enter('SCAN_RIGHT_TURN'); this.deps.status('Scanning right'); await turn('right', this.config.scanAngle * 2);
      this.enter('SCAN_RIGHT_SAMPLE'); const right = await this.read(this.now(), abort.signal); check();
      this.enter('RETURN_CENTER'); await turn('left', this.config.scanAngle);
      this.enter('CHOOSE_SIDE');
      if (Math.max(left, right) <= this.threshold + this.config.hysteresisCm) throw new Error('path blocked');
      const side = left >= right ? 'left' : 'right';
      this.enter('BYPASS_TURN'); this.deps.status(`Bypassing ${side}`); await turn(side, this.config.avoidanceTurn);
      this.enter('BYPASS_DRIVE');
      // Stationary until NEW forward clearance is available; braking is authoritative before translation.
      await this.read(this.now(), abort.signal); check();
      await move({ kind: 'distance', direction: 'forward', amount: this.config.bypassDistanceCm });
      this.enter('REALIGN'); await turn(side === 'left' ? 'right' : 'left', this.config.avoidanceTurn);
      const forward = async (phase: AvoidancePhase, amount: number) => {
        this.enter(phase);
        const front = await this.read(this.now(), abort.signal); check();
        if (front <= this.threshold) throw new Error('path blocked');
        await move({ kind: 'distance', direction: 'forward', amount });
      };
      // Pass the obstacle before mirroring the outward diagonal back toward the original path.
      this.deps.status(`Passing obstacle on ${side}`);
      await forward('PASS_DRIVE', this.config.passingDistanceCm);
      this.enter('RETURN_TURN'); this.deps.status('Returning to original path');
      await turn(side === 'left' ? 'right' : 'left', this.config.avoidanceTurn);
      await forward('RETURN_DRIVE', this.config.bypassDistanceCm);
      this.enter('FINAL_REALIGN'); await turn(side, this.config.avoidanceTurn);
      const front = await this.read(this.now(), abort.signal); check();
      if (front <= this.threshold) throw new Error('path blocked');
      this.enter('COMPLETE'); return true;
    } catch (error) {
      const reason = this.abortReason ?? (error instanceof Error ? error.message : 'avoidance failed');
      this.enter('ABORTED', reason);
      this.deps.status(reason === 'path blocked' ? 'Path blocked' : 'Avoidance stopped');
      await this.deps.stop(); return false;
    } finally { this.translating = false; if (this.abort === abort) this.abort = undefined; }
  }
}
