import { afterEach, expect, it, vi } from 'vitest';
import { FollowController, FOLLOW_DEFAULTS, TRACKED_FOLLOW_DEFAULTS } from '../src/core/FollowController';
import { ActionEngine } from '../src/core/ActionEngine';
import { RuleEngine } from '../src/core/RuleEngine';
import { followTargets } from '../src/core/DetectionManager';
import { makeAction, makeRule, type Detection } from '../src/core/types';
import { TargetTracker } from '../src/core/TargetTracker';
import { MockRobotAdapter } from './MockRobotAdapter';

const action = { ...makeAction('move'), ...FOLLOW_DEFAULTS, mode: 'follow' as const };
const box = (cx = .3, area = .04) => ({ x: cx - Math.sqrt(area) / 2, y: .2, width: Math.sqrt(area), height: Math.sqrt(area) });
const detection = (cx = .3, confidence = .85): Detection => {
  const b = box(cx);
  return { ...b, x: b.x * 640, y: b.y * 480, width: b.width * 640, height: b.height * 480,
    centerX: cx * 640, centerY: (b.y + b.height / 2) * 480, className: 'person', confidence };
};
const rule = () => ({ ...makeRule(), confidence: .7, minDuration: 0, actions: [{ ...action }] });
class Wheels extends MockRobotAdapter {
  setWheelSpeeds = vi.fn(async (left: number, right: number) => { this.state.left = left; this.state.right = right; });
}
afterEach(() => vi.useRealTimers());

it('retains the same person through confidence changes without acquiring below threshold', async () => {
  vi.useFakeTimers(); const r = rule(), rules = new RuleEngine(), robot = new Wheels(); await robot.connect();
  const engine = new ActionEngine(robot);
  expect(followTargets(r, [detection(.3, .65)], 640, 480)).toEqual([]);
  const frame = async (items: Detection[]) => {
    const triggered = rules.evaluate([r], items, performance.now());
    await engine.updateRules(triggered, rules.activeRules, { detections: items, width: 640, height: 480, capturedAt: performance.now() });
  };
  await frame([detection(.3, .71), detection(.9, .99)]);
  // Equal initial size: first person acquired. Confidence ordering cannot replace it.
  for (const confidence of [.65, .61, .69]) {
    await vi.advanceTimersByTimeAsync(300); await frame([detection(.31, confidence), detection(.9, .99)]);
    await vi.advanceTimersByTimeAsync(100); expect(engine.followSnapshot.waiting).toBe(false);
    expect(engine.followSnapshot.desired![0]).toBeLessThan(engine.followSnapshot.desired![1]);
  }
  await engine.stop();
});

it('rejects unrelated detections, preserves the lock through loss and reacquires within timeout', async () => {
  vi.useFakeTimers(); const lost = vi.fn(), c = new FollowController(action, vi.fn().mockResolvedValue(undefined), lost, vi.fn());
  const initial = box(.2); await c.update([initial]);
  await vi.advanceTimersByTimeAsync(100); await c.update([box(.9)]);
  expect(c.target).toBe(initial); expect(c.commandSnapshot.waiting).toBe(true);
  await vi.advanceTimersByTimeAsync(200); const near = box(.22); await c.update([box(.9), near]);
  expect(c.target).toBe(near); expect(c.commandSnapshot.waiting).toBe(false);
  await vi.advanceTimersByTimeAsync(500); expect(lost).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250); expect(lost).toHaveBeenCalledOnce(); expect(c.target).toBeNull();
});

it('ambiguous same-class crossings keep the previous lock rather than guessing', async () => {
  vi.useFakeTimers(); const c = new FollowController(action, vi.fn().mockResolvedValue(undefined), vi.fn(), vi.fn());
  const initial = box(.5); await c.update([initial]);
  await vi.advanceTimersByTimeAsync(100); await c.update([box(.49), box(.51)]);
  expect(c.target).toBe(initial); expect(c.commandSnapshot.waiting).toBe(true); c.cancel();
});

it('a stale class detection immediately stops owned wheels instead of renewing freshness', async () => {
  vi.useFakeTimers(); const robot = new Wheels(); await robot.connect(); const engine = new ActionEngine(robot), r = rule();
  const frame = { detections: [detection()], width: 640, height: 480, capturedAt: performance.now() };
  await engine.updateRules([r], [r], frame); await vi.advanceTimersByTimeAsync(300); await engine.updateRules([], [r], {...frame,capturedAt:performance.now()}); await vi.advanceTimersByTimeAsync(100); expect(robot.state.right).toBeGreaterThan(0);
  await engine.updateRules([], [r], { ...frame, capturedAt: performance.now() - 1000 });
  expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0); expect(engine.activeMotorOwnerRuleId).toBeNull();
});

it('duplicate class samples cannot renew a lock or prolong motion', async () => {
  vi.useFakeTimers(); const lost = vi.fn(), c = new FollowController(action, vi.fn().mockResolvedValue(undefined), lost, vi.fn());
  const at = performance.now(); await c.update([box()], at);
  await vi.advanceTimersByTimeAsync(500); await c.update([box()], at);
  expect(c.commandSnapshot.lastSeenAt).toBe(at);
  await vi.advanceTimersByTimeAsync(250); expect(lost).toHaveBeenCalledOnce();
});
it('a new Follow without a usable target releases previous motor ownership immediately', async () => {
  vi.useFakeTimers(); const robot = new Wheels(); await robot.connect(); const engine = new ActionEngine(robot), r = rule();
  const moving = { ...makeRule(), actions: [{ ...makeAction('move'), mode: 'continuous' as const, speed: 20 }] };
  await engine.updateRules([moving], [moving]); expect(robot.state.left).toBe(20);
  // A qualifying rule may still be in its grace window when Follow starts.
  await engine.updateRules([r], [r], { detections: [], width: 640, height: 480 });
  expect(engine.activeMotorOwnerRuleId).toBeNull(); expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
});

it('small wheel changes are suppressed while meaningful changes and centered STOP are sent', async () => {
  vi.useFakeTimers(); const send = vi.fn().mockResolvedValue(undefined), c = new FollowController(action, send, vi.fn(), vi.fn());
  await c.update([box(.5, .04)]); await vi.advanceTimersByTimeAsync(600); const initial = send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100); await c.update([box(.51, .041)]);
  expect(send).toHaveBeenCalledTimes(initial);
  await vi.advanceTimersByTimeAsync(100); await c.update([box(.3, .04)]); await vi.advanceTimersByTimeAsync(100);
  expect(send.mock.calls.length).toBeGreaterThan(initial);
  await vi.advanceTimersByTimeAsync(100); await c.update([box(.5, .126)]);
  expect(send.mock.calls.at(-1)!.slice(0, 2)).toEqual([0, 0]); c.cancel();
});

it('emergency STOP is not held behind an in-flight wheel command', async () => {
  vi.useFakeTimers(); const robot = new Wheels(); await robot.connect(); const engine = new ActionEngine(robot), r = rule();
  let release!: () => void;
  robot.setWheelSpeeds.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = engine.updateRules([r], [r], { detections: [detection()], width: 640, height: 480 });
  await vi.advanceTimersByTimeAsync(0); expect(robot.setWheelSpeeds).toHaveBeenCalledOnce();
  const stop = vi.spyOn(robot, 'stop'); await engine.stop(); expect(stop).toHaveBeenCalledOnce();
  release(); await pending; await vi.advanceTimersByTimeAsync(1000);
  expect(robot.setWheelSpeeds).toHaveBeenCalledOnce(); expect(engine.activeMotorOwnerRuleId).toBeNull();
});

function tracked(at = 0) {
  const tracker = new TargetTracker(), d = detection(.5);
  return tracker.initialize({ width: 640, height: 480, mask: new Uint8Array(), boundingBox: d,
    centroid: { x: 320, y: 144 }, area: d.width * d.height }, [d], false, at)!;
}
it('selected target last-seen time overrides a newly supplied timestamp', async () => {
  vi.useFakeTimers(); const robot = new Wheels(); await robot.connect(); const engine = new ActionEngine(robot);
  const t = tracked(performance.now());
  await engine.startSelectedFollow(t, performance.now(), 750, TRACKED_FOLLOW_DEFAULTS);
  await vi.advanceTimersByTimeAsync(500);
  await engine.updateSelectedTarget(t, performance.now(), 750, TRACKED_FOLLOW_DEFAULTS);
  await vi.advanceTimersByTimeAsync(250);
  expect(engine.followingSelectedTarget).toBe(false); expect(robot.state.left).toBe(0);
});

it('selected-target distance hold avoids forward/stop chatter and resumes after retreat', async () => {
  vi.useFakeTimers(); const send = vi.fn().mockResolvedValue(undefined), c = new FollowController(action, send, vi.fn(), vi.fn());
  const sample = async (area: number) => {
    await vi.advanceTimersByTimeAsync(100);
    await c.updateTracked({ ...tracked(performance.now()), normalizedArea: area }, performance.now(), 750, TRACKED_FOLLOW_DEFAULTS);
  };
  for(let i=0;i<5;i++) await sample(.08); expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  await sample(.121); expect(send.mock.calls.at(-1)!.slice(0, 2)).toEqual([0, 0]); const count = send.mock.calls.length;
  for (const area of [.119, .122, .115, .118]) await sample(area);
  expect(send).toHaveBeenCalledTimes(count);
  await sample(.09); await vi.advanceTimersByTimeAsync(100); expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(0); c.cancel();
});

it('selected detector smoothing reduces jitter without losing size or position continuity', () => {
  const tracker = new TargetTracker(), d = detection(.5);
  tracker.initialize({ width: 640, height: 480, mask: new Uint8Array(), boundingBox: d,
    centroid: { x: 320, y: 144 }, area: d.width * d.height }, [d], false, 0);
  const centers = [.51, .49, .51, .49].map((x, i) => tracker.update([detection(x)], (i + 1) * 100)!.relativeX);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(.02);
  expect(tracker.getTrackedTarget()!.state).toBe('TRACKING');
});

it('an expired selected lock cannot reacquire from a late detection without an aging tick', () => {
  const tracker = new TargetTracker(), d = detection(.5);
  tracker.initialize({ width: 640, height: 480, mask: new Uint8Array(), boundingBox: d,
    centroid: { x: 320, y: 144 }, area: d.width * d.height }, [d], false, 0);
  expect(tracker.update([d], 3000)!.state).toBe('LOST');
  expect(tracker.update([d], 3100)!.state).toBe('LOST');
});
