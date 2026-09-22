import type { Action } from './types';

export const FOLLOW_AREAS = { close: 0.22, medium: 0.14, far: 0.08 } as const;
export const FOLLOW_DEFAULTS = { followSpeed: 35, followDistance: 'medium' as const,
  steeringSensitivity: 50, centerDeadZone: 0.15, lostTargetTimeoutMs: 750 };
export const FOLLOW_DISTANCE_DEADBAND = 0.015;
export interface FollowTarget { x: number; y: number; width: number; height: number }
export function followWheels(target: FollowTarget, action: Action): [number, number] {
  const config = { ...FOLLOW_DEFAULTS, ...action };
  const error = Math.max(-1, Math.min(1, (target.x + target.width / 2 - 0.5) * 2));
  const desired = FOLLOW_AREAS[config.followDistance];
  const distance = desired - target.width * target.height;
  const proportional = Math.max(0, Math.min(1, (distance - FOLLOW_DISTANCE_DEADBAND) / desired));
  // Avoid crawling below useful drive power while still respecting the chosen speed cap.
  const forward = proportional > 0 ? Math.max(Math.min(10, config.followSpeed), config.followSpeed * proportional) : 0;
  const turn = Math.max(0, (Math.abs(error) - config.centerDeadZone) / (1 - config.centerDeadZone));
  const correction = Math.min(0.95, turn * config.steeringSensitivity / 50);
  const inner = forward * (1 - correction);
  const limit = (speed: number) => Math.round(Math.max(0, Math.min(100, config.followSpeed, speed)));
  // Keep the outside wheel driving; progressively slow the inside wheel, never pivot/reverse.
  return error < 0 ? [limit(inner), limit(forward)] : [limit(forward), limit(inner)];
}
export class FollowController {
  target: FollowTarget | null = null;
  lastTargetSeenAt = 0;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private previous?: [number, number];
  private sending = false;
  private filtered: FollowTarget | null = null;
  private atDistance = false;
  constructor(private action: Action,
    private send: (left: number, right: number, signal: AbortSignal) => Promise<void>,
    private lost: () => void,
    private failed: () => void) {}
  cancel() { this.abort.abort(); clearTimeout(this.timer); this.target = null; this.previous = undefined; this.filtered = null; this.atDistance = false; }
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
    const wheels: [number, number] = this.atDistance ? [0, 0] : followWheels(this.filtered, this.action);
    if (this.sending || (this.previous && wheels.every((v, i) => Math.abs(v - this.previous![i]) < 2) &&
      !(wheels.every(v => v === 0) && this.previous.some(v => v !== 0)))) return;
    this.sending = true;
    try { await this.send(...wheels, this.abort.signal); if (!this.abort.signal.aborted) this.previous = wheels; }
    catch { if (!this.abort.signal.aborted) { this.cancel(); this.failed(); } }
    finally { this.sending = false; }
  }
}
