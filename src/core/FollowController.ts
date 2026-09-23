import type { Action } from './types';
import type { TrackedTarget } from './TargetTracker';

export const TRACKED_FOLLOW_DEFAULTS = {
  baseSpeed: 30, steeringGain: 25, maxSpeed: 50, deadZone: 0.10,
  pivotThreshold: 0.65, farArea: 0.12, nearArea: 0.22, minConfidence: 0.35,
};
export type TrackedFollowSettings = typeof TRACKED_FOLLOW_DEFAULTS;
export function trackedFollowCommand(target: TrackedTarget, config: TrackedFollowSettings) {
  const error = Math.max(-1, Math.min(1, target.horizontalError));
  const area = target.normalizedArea;
  const forward = area < config.farArea ? Math.min(config.baseSpeed, config.maxSpeed) : 0;
  const magnitude = Math.max(0, (Math.abs(error) - config.deadZone) / (1 - config.deadZone));
  const steering = Math.sign(error) * Math.min(config.maxSpeed, magnitude * config.steeringGain);
  // At the desired distance use a small one-wheel correction. Never reverse.
  const turnLimit = forward ? (Math.abs(error) <= config.pivotThreshold ? forward * 0.9 : config.maxSpeed) : 10;
  const correction = Math.max(-turnLimit, Math.min(turnLimit, steering));
  let left = Math.max(0, Math.min(config.maxSpeed, forward + correction));
  let right = Math.max(0, Math.min(config.maxSpeed, forward - correction));
  if (Math.abs(error) > config.pivotThreshold) {
    const remaining = Math.max(0, (1 - Math.abs(error)) / (1 - config.pivotThreshold));
    if (error < 0) left *= remaining; else right *= remaining;
  }
  if (area >= config.nearArea || target.targetLost) left = right = 0;
  return { error, area, forward: area >= config.nearArea ? 0 : forward,
    steering: area >= config.nearArea ? 0 : correction, left: Math.round(left), right: Math.round(right), tracking: target.state };
}

export const FOLLOW_AREAS = { close: 0.22, medium: 0.14, far: 0.08 } as const;
export const FOLLOW_DEFAULTS = { followSpeed: 35, followDistance: 'medium' as const,
  steeringSensitivity: 50, centerDeadZone: 0.15, lostTargetTimeoutMs: 750 };
export const FOLLOW_DISTANCE_DEADBAND = 0.015;
export interface FollowTarget { x: number; y: number; width: number; height: number }
export function followWheels(target: FollowTarget, action: Action, stopForward = false): [number, number] {
  const config = { ...FOLLOW_DEFAULTS, ...action };
  const error = Math.max(-1, Math.min(1, (target.x + target.width / 2 - 0.5) * 2));
  const desired = FOLLOW_AREAS[config.followDistance];
  const distance = desired - target.width * target.height;
  const proportional = Math.max(0, Math.min(1, (distance - FOLLOW_DISTANCE_DEADBAND) / desired));
  // Avoid crawling below useful drive power while still respecting the chosen speed cap.
  const speedCap = Math.max(0, Math.min(100, config.followSpeed));
  const forward = !stopForward && proportional > 0 ? Math.max(Math.min(10, speedCap), speedCap * proportional) : 0;
  const turn = Math.max(0, (Math.abs(error) - config.centerDeadZone) / (1 - config.centerDeadZone));
  // Linear response avoids a large kick immediately outside the center tolerance.
  const correction = Math.min(1, turn * config.steeringSensitivity / 50);
  const drive = forward * (1 - correction);
  const rotation = speedCap * correction;
  const limit = (speed: number) => Math.round(Math.max(0, Math.min(speedCap, speed)));
  return error < 0 ? [limit(drive - rotation), limit(drive + rotation)] :
    [limit(drive + rotation), limit(drive - rotation)];
}
export class FollowController {
  target: FollowTarget | null = null;
  lastTargetSeenAt = 0;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private previous?: [number, number];
  private sending = false;
  private pending?: [number, number];
  private steeringTimer?: ReturnType<typeof setTimeout>;
  private steeringSample?: { error: number; at: number };
  private centered = false;
  private steeringHoldMs = 250;
  private filtered: FollowTarget | null = null;
  private atDistance = false;
  private trackedAt = -Infinity;
  diagnostics: ReturnType<typeof trackedFollowCommand> | null = null;
  constructor(private action: Action,
    private send: (left: number, right: number, signal: AbortSignal) => Promise<void>,
    private lost: () => void,
    private failed: () => void) {}
  cancel() { this.abort.abort(); clearTimeout(this.timer); clearTimeout(this.steeringTimer); this.pending = undefined; this.target = null; this.previous = undefined; this.filtered = null; this.atDistance = false; }
  private steeringError(error: number, at: number, deadZone: number) {
    const old = this.steeringSample;
    this.steeringSample = { error, at };
    const dt = old ? (at - old.at) / 1000 : 0;
    if (dt > 0) this.steeringHoldMs = Math.max(120, Math.min(300, dt * 700));
    // Release the center hold only beyond a small margin, avoiding left/right chatter.
    if (Math.abs(error) <= deadZone) this.centered = true;
    else if (Math.abs(error) > deadZone + 0.03) this.centered = false;
    if (this.centered) return 0;
    if (!old || dt < 0.05 || dt > 1) return error;
    const velocity = (error - old.error) / dt;
    // Brake on approach; prediction must never create an opposite-direction turn.
    if (error * velocity < 0) return Math.sign(error) * Math.max(0, Math.abs(error) - Math.abs(velocity) * 0.30);
    return error;
  }
  private async drive(wheels: [number, number], capturedAt: number) {
    clearTimeout(this.steeringTimer);
    if (wheels[0] !== wheels[1]) {
      // A turn has a shorter lease than target loss. Keep safe forward motion,
      // but stop turning when the detector has not supplied fresh feedback.
      const straight = Math.max(0, Math.min(...wheels));
      const remaining = this.steeringHoldMs - Math.max(0, performance.now() - capturedAt);
      if (remaining <= 0) wheels = [straight, straight];
      else this.steeringTimer = setTimeout(() => {
        if (this.abort.signal.aborted) return;
        if (this.diagnostics) this.diagnostics = { ...this.diagnostics, left: straight, right: straight, forward: straight, steering: 0 };
        void this.dispatch([straight, straight]);
      }, remaining);
    }
    await this.dispatch(wheels);
  }
  /** Tracker already smooths geometry. Only fresh reliable samples renew the watchdog. */
  async updateTracked(target: TrackedTarget | null, capturedAt: number, timeoutMs: number, config: TrackedFollowSettings) {
    if (this.abort.signal.aborted) return;
    const timeout = Math.min(2500, Math.max(100, timeoutMs));
    const age = performance.now() - capturedAt;
    if (!target?.active || target.targetLost || target.state === 'LOST' || !Number.isFinite(age) || age < 0 || age >= timeout ||
      ![target.horizontalError, target.normalizedArea, target.trackingConfidence].every(Number.isFinite)) {
      this.cancel(); this.lost(); return;
    }
    if (target.state !== 'TRACKING' || target.trackingConfidence < config.minConfidence || capturedAt <= this.trackedAt) return;
    this.trackedAt = capturedAt;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.cancel(); this.lost(); }, timeout - age);
    const error = this.steeringError(target.horizontalError, capturedAt, config.deadZone);
    this.diagnostics = trackedFollowCommand({ ...target, horizontalError: error }, config);
    this.diagnostics.error = target.horizontalError;
    await this.drive([this.diagnostics.left, this.diagnostics.right], capturedAt);
  }
  async update(targets: FollowTarget[], now = performance.now()) {
    const timeout = this.action.lostTargetTimeoutMs ?? FOLLOW_DEFAULTS.lostTargetTimeoutMs;
    const age = Math.max(0, performance.now() - now);
    if (this.abort.signal.aborted || age >= timeout) return;
    const previous = this.target;
    const centerDistance = (t: FollowTarget) => previous ?
      (t.x + t.width / 2 - previous.x - previous.width / 2) ** 2 +
      (t.y + t.height / 2 - previous.y - previous.height / 2) ** 2 : 0;
    const target = [...targets].sort((a, b) => previous ? centerDistance(a) - centerDistance(b) : b.width * b.height - a.width * a.height)[0];
    if (!target) return; // Independent timer also covers inference that stops producing frames.
    this.target = target;
    this.lastTargetSeenAt = now;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.cancel(); this.lost(); }, timeout - age);
    const desired = FOLLOW_AREAS[this.action.followDistance ?? FOLLOW_DEFAULTS.followDistance];
    const area = target.width * target.height;
    // Stop promptly on approach, but require a clear retreat before driving again.
    if (area >= desired - FOLLOW_DISTANCE_DEADBAND) this.atDistance = true;
    else if (area < desired - 2 * FOLLOW_DISTANCE_DEADBAND) this.atDistance = false;
    const alpha = 0.4;
    const old = this.filtered;
    this.filtered = old ? {
      x: old.x + alpha * (target.x - old.x), y: old.y + alpha * (target.y - old.y),
      width: old.width + alpha * (target.width - old.width), height: old.height + alpha * (target.height - old.height),
    } : { ...target };
    // Smooth size/distance, but don't delay the horizontal feedback a second time.
    const error = this.steeringError((target.x + target.width / 2 - 0.5) * 2, now,
      this.action.centerDeadZone ?? FOLLOW_DEFAULTS.centerDeadZone);
    const wheels = followWheels({ ...this.filtered, x: (1 + error) / 2 - this.filtered.width / 2 }, this.action, this.atDistance);
    await this.drive(wheels, now);
  }
  private async dispatch(wheels: [number, number]) {
    if (this.abort.signal.aborted) return;
    this.pending = wheels;
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending && !this.abort.signal.aborted) {
        const next = this.pending; this.pending = undefined;
        const old = this.previous;
        const stateChanged = old && (Math.sign(next[0] - next[1]) !== Math.sign(old[0] - old[1]) ||
          (next.every(v => v === 0) !== old.every(v => v === 0)));
        if (old && !stateChanged && next.every((v, i) => Math.abs(v - old[i]) < 2)) continue;
        await this.send(...next, this.abort.signal);
        if (!this.abort.signal.aborted) this.previous = next;
      }
    }
    catch { if (!this.abort.signal.aborted) { this.cancel(); this.failed(); } }
    finally { this.sending = false; }
  }
}
