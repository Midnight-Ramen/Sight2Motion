import type { Action } from './types';
import type { TrackedTarget } from './TargetTracker';

export const STEERING_SMOOTHING = { errorAlpha: 0.25, centerHysteresis: 0.02, wheelMaxDelta: 4, curveExponent: 1.3 };
export const FOLLOW_CONTROL_INTERVAL_MS = 100;
export const FOLLOW_LAUNCH = { steeringMs: 600, forwardMs: 500, initialSteering: 0.5,
  largeError: 0.30, largeErrorSteering: 0.85 };
export function followLaunchRamp(elapsed: number, error: number) {
  const progress = (duration: number) => Math.max(0, Math.min(1, elapsed / duration));
  const large = Math.max(0, Math.min(1, (Math.abs(error) - FOLLOW_LAUNCH.largeError) / FOLLOW_LAUNCH.largeError));
  const initial = FOLLOW_LAUNCH.initialSteering + large * (FOLLOW_LAUNCH.largeErrorSteering - FOLLOW_LAUNCH.initialSteering);
  return { steering: initial + (1 - initial) * progress(FOLLOW_LAUNCH.steeringMs), forward: progress(FOLLOW_LAUNCH.forwardMs) };
}
export const FOLLOW_ACQUISITION = { settleMs: 300, farArea: 0.02, fullArea: 0.12,
  minimumSteeringScale: 0.5, extraDeadZone: 0.04, maximumForwardReduction: 0.4 };
export function followDistanceTuning(area: number, configuredDeadZone: number) {
  const t = Math.max(0, Math.min(1, (area - FOLLOW_ACQUISITION.farArea) /
    (FOLLOW_ACQUISITION.fullArea - FOLLOW_ACQUISITION.farArea)));
  const blend = t * t * (3 - 2 * t);
  return { steeringScale: FOLLOW_ACQUISITION.minimumSteeringScale + (1 - FOLLOW_ACQUISITION.minimumSteeringScale) * blend,
    deadZone: Math.min(0.95, configuredDeadZone + FOLLOW_ACQUISITION.extraDeadZone * (1 - blend)) };
}
const alignmentScale = (error: number, deadZone: number) => 1 - FOLLOW_ACQUISITION.maximumForwardReduction *
  Math.max(0, Math.min(1, (Math.abs(error) - deadZone) / (1 - deadZone)));
export const TRACKED_FOLLOW_DEFAULTS = {
  baseSpeed: 30, steeringGain: 25, maxSpeed: 50, deadZone: 0.10,
  pivotThreshold: 0.65, farArea: 0.12, nearArea: 0.22, minConfidence: 0.35,
};
export type TrackedFollowSettings = typeof TRACKED_FOLLOW_DEFAULTS;
export function trackedFollowCommand(target: TrackedTarget, config: TrackedFollowSettings) {
  const error = Math.max(-1, Math.min(1, target.horizontalError));
  const area = target.normalizedArea;
  const tuning = followDistanceTuning(area, config.deadZone);
  const forward = area < config.farArea ? Math.min(config.baseSpeed, config.maxSpeed) * alignmentScale(error, tuning.deadZone) : 0;
  const magnitude = Math.max(0, (Math.abs(error) - tuning.deadZone) / (1 - tuning.deadZone));
  const steering = Math.sign(error) * Math.min(config.maxSpeed, magnitude ** STEERING_SMOOTHING.curveExponent * config.steeringGain) * tuning.steeringScale;
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
export const FOLLOW_STABILITY = { alpha: 0.4, confidenceMargin: 0.1, maxCenterJump: 0.45,
  minSizeSimilarity: 0.3, ambiguityMargin: 0.025, wheelDelta: 1 };
export interface FollowTarget { x: number; y: number; width: number; height: number }
/** Continuity score in normalized display coordinates; unrelated boxes cannot take over a lock. */
export function followMatch(previous: FollowTarget, candidate: FollowTarget) {
  const distance = Math.hypot(candidate.x + candidate.width / 2 - previous.x - previous.width / 2,
    candidate.y + candidate.height / 2 - previous.y - previous.height / 2);
  const a = previous.width * previous.height, b = candidate.width * candidate.height;
  const size = Math.min(a, b) / Math.max(a, b);
  if (distance > FOLLOW_STABILITY.maxCenterJump || size < FOLLOW_STABILITY.minSizeSimilarity) return -Infinity;
  const overlap = Math.max(0, Math.min(previous.x + previous.width, candidate.x + candidate.width) - Math.max(previous.x, candidate.x)) *
    Math.max(0, Math.min(previous.y + previous.height, candidate.y + candidate.height) - Math.max(previous.y, candidate.y));
  return .55 * overlap / (a + b - overlap) + .3 * (1 - distance / FOLLOW_STABILITY.maxCenterJump) + .15 * size;
}
export function followWheels(target: FollowTarget, action: Action, stopForward = false): [number, number] {
  const config = { ...FOLLOW_DEFAULTS, ...action };
  const error = Math.max(-1, Math.min(1, (target.x + target.width / 2 - 0.5) * 2));
  const desired = FOLLOW_AREAS[config.followDistance];
  const tuning = followDistanceTuning(target.width * target.height, config.centerDeadZone);
  const distance = desired - target.width * target.height;
  const proportional = Math.max(0, Math.min(1, (distance - FOLLOW_DISTANCE_DEADBAND) / desired));
  // Avoid crawling below useful drive power while still respecting the chosen speed cap.
  const speedCap = Math.max(0, Math.min(100, config.followSpeed));
  const forward = !stopForward && proportional > 0 ? Math.max(Math.min(10, speedCap), speedCap * proportional) : 0;
  const turn = Math.max(0, (Math.abs(error) - tuning.deadZone) / (1 - tuning.deadZone));
  // Gentle near center, retaining the full steering range for large errors.
  const correction = Math.min(1, turn ** STEERING_SMOOTHING.curveExponent * config.steeringSensitivity / 50) * tuning.steeringScale;
  const drive = forward * alignmentScale(error, tuning.deadZone) * (1 - correction);
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
  private dispatched?: [number, number];
  private sending = false;
  private pending?: { wheels: [number, number]; immediate: boolean };
  private controlTimer?: ReturnType<typeof setInterval>;
  private desired: [number, number] = [0, 0];
  private targetDeadline = -Infinity;
  private steeringSample?: { error: number; at: number };
  private centered = true;
  private rawError?: number;
  private smoothedError?: number;
  private filtered: FollowTarget | null = null;
  private atDistance = false;
  private trackedAt = -Infinity;
  private settlingSince?: number;
  private locked = false;
  private distanceTuning?: ReturnType<typeof followDistanceTuning>;
  private settlingSamples: { at: number; error: number }[] = [];
  private lockedAt?: number;
  private resetSettling() {
    this.settlingSince = undefined; this.settlingSamples = []; this.lockedAt = undefined;
    this.smoothedError = undefined; this.steeringSample = undefined; this.centered = true;
  }
  private get launchRamp() {
    return followLaunchRamp(this.lockedAt === undefined ? 0 : performance.now() - this.lockedAt, this.smoothedError ?? 0);
  }
  diagnostics: ReturnType<typeof trackedFollowCommand> | null = null;
  private waitingForTarget = false;
  /** Read-only snapshot of the last dispatched command, not measured wheel speed. */
  get commandSnapshot() {
    return { active: !this.abort.signal.aborted, waiting: this.waitingForTarget,
      rawError: this.rawError, smoothedError: this.smoothedError,
      targetLock: !this.locked ? 'Settling' : this.launchRamp.steering < 1 || this.launchRamp.forward < 1 ? 'Soft start' : 'Locked',
      steeringRamp: this.launchRamp.steering, forwardRamp: this.locked ? this.launchRamp.forward : 0, steeringScale: this.distanceTuning?.steeringScale,
      effectiveCenterTolerance: this.distanceTuning?.deadZone,
      desired: [...this.desired] as [number, number],
      lastSeenAt: this.target || this.trackedAt > -Infinity ? this.lastTargetSeenAt : undefined,
      wheels: this.previous ? [...this.previous] as [number, number] : null };
  }
  constructor(private action: Action,
    private send: (left: number, right: number, signal: AbortSignal) => Promise<void>,
    private lost: () => void,
    private failed: () => void) {}
  cancel() { this.locked = false; this.resetSettling(); this.abort.abort(); clearTimeout(this.timer); clearInterval(this.controlTimer); this.controlTimer = undefined; this.desired = [0, 0]; this.pending = undefined; this.target = null; this.previous = undefined; this.dispatched = undefined; this.filtered = null; this.atDistance = false; }
  private steeringError(error: number, at: number, deadZone: number) {
    if (!this.locked) {
      this.settlingSince ??= at;
      this.settlingSamples = this.settlingSamples.filter(sample => at - sample.at <= FOLLOW_ACQUISITION.settleMs);
      if (this.settlingSamples.at(-1)?.at !== at) this.settlingSamples.push({ at, error });
      this.rawError = error;
      this.smoothedError = this.settlingSamples.reduce((sum, sample) => sum + sample.error, 0) / this.settlingSamples.length;
      this.centered = Math.abs(this.smoothedError) <= deadZone;
      this.steeringSample = { error: this.smoothedError, at };
      if (at - this.settlingSince >= FOLLOW_ACQUISITION.settleMs) {
        this.locked = true; this.lockedAt = performance.now(); this.settlingSamples = [];
      }
      return this.centered ? 0 : this.smoothedError;
    }
    const old = this.steeringSample;
    this.steeringSample = { error, at };
    const dt = old ? (at - old.at) / 1000 : 0;
    this.rawError = error;
    const wasCentered = this.centered;
    this.smoothedError = this.smoothedError === undefined ? error :
      this.smoothedError + STEERING_SMOOTHING.errorAlpha * (error - this.smoothedError);
    // Raw centered feedback releases a turn promptly; filtering must not drag it across center.
    if (Math.abs(error) <= Math.max(0, deadZone - STEERING_SMOOTHING.centerHysteresis)) this.centered = true;
    else if (Math.abs(error) > deadZone + STEERING_SMOOTHING.centerHysteresis) this.centered = false;
    if (this.centered || error * this.smoothedError < 0) {
      this.smoothedError = 0;
      return 0;
    }
    // Seed a genuine departure immediately; the softer curve and wheel ramp bound its response.
    if (wasCentered && this.launchRamp.steering >= 1) this.smoothedError = error;
    const filtered = this.smoothedError;
    if (!old || dt < 0.05 || dt > 1) return filtered;
    const velocity = (error - old.error) / dt;
    // Brake on approach; prediction must never create an opposite-direction turn.
    if (error * velocity < 0) return Math.sign(filtered) * Math.max(0, Math.abs(filtered) - Math.abs(velocity) * 0.30);
    return filtered;
  }
  private async controlTick() {
    if (this.abort.signal.aborted) return;
    if (performance.now() >= this.targetDeadline) { this.cancel(); this.lost(); return; }
    if (!this.locked) { await this.dispatch([0, 0], true); return; }
    if (this.sending) return;
    const current = this.dispatched ?? [0, 0];
    const ramp = this.launchRamp;
    const forward = (this.desired[0] + this.desired[1]) / 2 * ramp.forward;
    const steering = (this.desired[0] - this.desired[1]) / 2 * ramp.steering;
    const cap = Math.max(...this.desired);
    const launch = this.waitingForTarget ? this.desired : [Math.max(0, Math.min(cap, forward + steering)), Math.max(0, Math.min(cap, forward - steering))];
    const next = launch.map((value, i) => Math.round(current[i] + Math.max(-STEERING_SMOOTHING.wheelMaxDelta,
      Math.min(STEERING_SMOOTHING.wheelMaxDelta, value - current[i])))) as [number, number];
    await this.dispatch(next);
  }
  private async drive(wheels: [number, number]) {
    this.desired = wheels;
    if (!this.locked) await this.dispatch([0, 0], true);
    if (this.abort.signal.aborted) return;
    // Perception only sets a destination. One motor clock interpolates until the loss watchdog expires.
    if (this.controlTimer === undefined) {
      this.controlTimer = setInterval(() => { void this.controlTick(); }, FOLLOW_CONTROL_INTERVAL_MS);
      if (!wheels.every(v => v === 0)) await this.controlTick();
    }
    if (wheels.every(v => v === 0)) await this.dispatch([0, 0], true);
  }
  /** Tracker already smooths geometry. Only fresh reliable samples renew the watchdog. */
  async updateTracked(target: TrackedTarget | null, capturedAt: number, timeoutMs: number, config: TrackedFollowSettings) {
    if (this.abort.signal.aborted) return;
    const timeout = Math.min(2500, Math.max(100, timeoutMs));
    capturedAt = target?.lastSeenAt ?? capturedAt;
    const age = performance.now() - capturedAt;
    if (!target?.active || target.targetLost || target.state === 'LOST' || !Number.isFinite(age) || age < 0 || age >= timeout ||
      ![target.horizontalError, target.normalizedArea, target.trackingConfidence].every(Number.isFinite)) {
      this.cancel(); this.lost(); return;
    }
    this.waitingForTarget = target.state !== 'TRACKING' || target.trackingConfidence < config.minConfidence;
    if (this.waitingForTarget) {
      if (!this.locked && target.state !== 'TRACKING') this.resetSettling();
      this.desired = [...(this.dispatched ?? [0, 0])]; return;
    }
    if (capturedAt <= this.trackedAt) return;
    this.trackedAt = capturedAt;
    this.lastTargetSeenAt = capturedAt;
    this.targetDeadline = capturedAt + timeout;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.cancel(); this.lost(); }, timeout - age);
    this.distanceTuning = followDistanceTuning(target.normalizedArea, config.deadZone);
    const error = this.steeringError(target.horizontalError, capturedAt, this.distanceTuning.deadZone);
    if (target.normalizedArea >= config.farArea) this.atDistance = true;
    else if (target.normalizedArea < config.farArea - FOLLOW_DISTANCE_DEADBAND) this.atDistance = false;
    this.diagnostics = trackedFollowCommand({ ...target, horizontalError: error },
      this.atDistance ? { ...config, baseSpeed: 0 } : config);
    this.diagnostics.error = target.horizontalError;
    await this.drive([this.diagnostics.left, this.diagnostics.right]);
  }
  async update(targets: FollowTarget[], now = performance.now()) {
    const timeout = this.action.lostTargetTimeoutMs ?? FOLLOW_DEFAULTS.lostTargetTimeoutMs;
    const age = performance.now() - now;
    if (this.abort.signal.aborted) return;
    if (!Number.isFinite(age) || age < 0 || age >= timeout) { this.cancel(); this.lost(); return; }
    if (this.target && now <= this.lastTargetSeenAt && age > 0) return;
    const previous = this.target;
    const candidates = targets.filter(t => [t.x, t.y, t.width, t.height].every(Number.isFinite) && t.width > 0 && t.height > 0)
      .map(t => ({ target: t, score: previous ? followMatch(previous, t) : t.width * t.height }))
      .filter(t => Number.isFinite(t.score)).sort((a, b) => b.score - a.score);
    const ambiguous = previous && candidates[1] && candidates[0].score - candidates[1].score < FOLLOW_STABILITY.ambiguityMargin;
    const target = ambiguous ? undefined : candidates[0]?.target;
    this.waitingForTarget = !target;
    if (!target) {
      if (!this.locked) this.resetSettling();
      this.desired = [...(this.dispatched ?? [0, 0])];
      if (!previous) { this.cancel(); this.lost(); }
      return; // Existing locks retain their independent loss watchdog.
    }
    this.target = target;
    this.lastTargetSeenAt = now;
    this.targetDeadline = now + timeout;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.cancel(); this.lost(); }, timeout - age);
    const desired = FOLLOW_AREAS[this.action.followDistance ?? FOLLOW_DEFAULTS.followDistance];
    const area = target.width * target.height;
    // Stop promptly on approach, but require a clear retreat before driving again.
    if (area >= desired - FOLLOW_DISTANCE_DEADBAND) this.atDistance = true;
    else if (area < desired - 2 * FOLLOW_DISTANCE_DEADBAND) this.atDistance = false;
    const alpha = FOLLOW_STABILITY.alpha;
    const old = this.filtered;
    this.filtered = old ? {
      x: old.x + alpha * (target.x - old.x), y: old.y + alpha * (target.y - old.y),
      width: old.width + alpha * (target.width - old.width), height: old.height + alpha * (target.height - old.height),
    } : { ...target };
    // Size smoothing and steering-error smoothing are independent.
    this.distanceTuning = followDistanceTuning(this.filtered.width * this.filtered.height,
      this.action.centerDeadZone ?? FOLLOW_DEFAULTS.centerDeadZone);
    const error = this.steeringError((target.x + target.width / 2 - 0.5) * 2, now,
      this.distanceTuning.deadZone);
    const wheels = followWheels({ ...this.filtered, x: (1 + error) / 2 - this.filtered.width / 2 }, this.action, this.atDistance);
    await this.drive(wheels);
  }
  private async dispatch(wheels: [number, number], immediate = false) {
    if (this.abort.signal.aborted) return;
    this.pending = { wheels, immediate };
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending && !this.abort.signal.aborted) {
        const { wheels: next, immediate: urgent } = this.pending; this.pending = undefined;
        const old = this.previous;
        const stopping = next.every(v => v === 0);
        if (old && next.every((v, i) => v === old[i])) continue;
        if (old && !urgent && !stopping && next.every((v, i) => Math.abs(v - old[i]) < FOLLOW_STABILITY.wheelDelta)) continue;
        this.dispatched = next;
        await this.send(...next, this.abort.signal);
        if (!this.abort.signal.aborted) this.previous = next;
      }
    }
    catch { if (!this.abort.signal.aborted) { this.cancel(); this.failed(); } }
    finally { this.sending = false; }
  }
}
