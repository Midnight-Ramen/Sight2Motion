import { afterEach, expect, it, vi } from 'vitest';
import { FollowController, STEERING_SMOOTHING, TRACKED_FOLLOW_DEFAULTS as settings } from '../src/core/FollowController';
import { makeAction } from '../src/core/types';
import type { TrackedTarget } from '../src/core/TargetTracker';

const target = (error: number, area = .04): TrackedTarget => ({ active: true, state: 'TRACKING', label: 'person',
  centerX: 320 * (1 + error), centerY: 240, boundingBox: { x: 0, y: 0, width: 100, height: 100 },
  relativeX: (1 + error) / 2, relativeY: .5, normalizedWidth: Math.sqrt(area), normalizedHeight: Math.sqrt(area),
  normalizedArea: area, size: area, errorX: error * 320, horizontalError: error, confidence: .9,
  trackingConfidence: .9, lostFrames: 0, targetLost: false });
function setup() {
  vi.useFakeTimers();
  const send = vi.fn(async (_left: number, _right: number, _signal: AbortSignal) => {});
  const lost = vi.fn(), c = new FollowController(makeAction('move'), send, lost, vi.fn());
  const sample = async (error: number, area = .04, config = settings) => {
    await vi.advanceTimersByTimeAsync(40);
    await c.updateTracked(target(error, area), performance.now(), 750, config);
  };
  return { c, send, sample, lost };
}
afterEach(() => vi.useRealTimers());

it('damps noisy horizontal error with the centralized exponential filter', async () => {
  const { c, sample } = setup(), raw = [.4, .42, .38, .41, .39, .42, .38], filtered: number[] = [];
  for (const error of raw) { await sample(error); filtered.push(c.commandSnapshot.smoothedError!); }
  expect(Math.max(...filtered) - Math.min(...filtered)).toBeLessThan((Math.max(...raw) - Math.min(...raw)) / 2);
  expect(c.commandSnapshot.rawError).toBe(.38); c.cancel();
});

it('holds centered jitter straight, with internal entry and exit hysteresis', async () => {
  const { c, send, sample } = setup(), config = { ...settings, deadZone: .15 };
  for(let i=0;i<26;i++) await sample(0, .04, config);
  for (const error of [0, .14, -.14, .16, -.16]) {
    await sample(error, .04, config); expect(c.commandSnapshot.smoothedError).toBe(0);
  }
  expect(send.mock.calls.every(([left, right]) => left === right)).toBe(true);
  expect(c.commandSnapshot.desired).toEqual([30, 30]);
  await sample(.23, .04, config); expect(c.commandSnapshot.smoothedError).toBeGreaterThan(0);
  await sample(.19, .04, config); expect(c.commandSnapshot.smoothedError).toBeGreaterThan(0);
  await sample(.12, .04, config); expect(c.commandSnapshot.smoothedError).toBe(0); c.cancel();
});

it('suppresses tiny wheel changes but propagates a meaningful steering change', async () => {
  const { c, send, sample } = setup();
  await sample(.4);
  for (let i = 0; i < 30; i++) await sample(.4); // Settle the independent startup ramp.
  const count = send.mock.calls.length;
  for (const error of [.401, .402, .399, .4]) await sample(error);
  expect(send).toHaveBeenCalledTimes(count);
  await sample(.8); await vi.advanceTimersByTimeAsync(100); expect(send.mock.calls.length).toBeGreaterThan(count); c.cancel();
});

it('ramps wheel commands across a center crossing without an abrupt reversal', async () => {
  const { c, send, sample } = setup(); for(let i=0;i<10;i++) await sample(.8);
  for (let i = 0; i < 12; i++) await sample(-.8);
  expect(send.mock.calls.length).toBeGreaterThan(3);
  for (let i = 1; i < send.mock.calls.length; i++) for (let wheel = 0; wheel < 2; wheel++) {
    expect(Math.abs(Number(send.mock.calls[i][wheel]) - Number(send.mock.calls[i - 1][wheel]))).toBeLessThanOrEqual(STEERING_SMOOTHING.wheelMaxDelta);
  }
  const final = send.mock.calls.at(-1)!; expect(final[0]).toBeLessThan(final[1]);
  expect(send.mock.calls.slice(1).every(([left, right]) => left > 0 || right > 0)).toBe(true); c.cancel();
});

it('STOP bypasses the ramp and the small-change threshold', async () => {
  const { c, send, sample } = setup(); for(let i=0;i<10;i++) await sample(.8); await vi.advanceTimersByTimeAsync(200);
  expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(6);
  await sample(.8, .23); expect(send.mock.calls.at(-1)!.slice(0, 2)).toEqual([0, 0]); c.cancel();
  const small = setup(); for(let i=0;i<26;i++) await small.sample(0, .04, { ...settings, baseSpeed: 2 });
  expect(small.send.mock.calls.at(-1)!.slice(0, 2)).toEqual([2, 2]);
  await small.sample(0, .23); expect(small.send.mock.calls.at(-1)!.slice(0, 2)).toEqual([0, 0]); small.c.cancel();
});

it('interpolation continues between detections without extending the loss watchdog', async () => {
  const { c, send, sample, lost } = setup(); for(let i=0;i<10;i++) await sample(.8);
  const before = send.mock.calls.at(-1)!;
  await vi.advanceTimersByTimeAsync(250);
  expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(before[0]);
  await vi.advanceTimersByTimeAsync(500); expect(lost).toHaveBeenCalledOnce(); expect(c.commandSnapshot.active).toBe(false);
});

it('an in-flight command still bounds the next steering update', async () => {
  const { c, send, sample } = setup(); for(let i=0;i<10;i++) await sample(.8); send.mockClear(); let release!: () => void;
  send.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const first = c.updateTracked(target(.8, .23), performance.now(), 750, settings);
  await vi.advanceTimersByTimeAsync(40);
  await c.updateTracked(target(-.8), performance.now(), 750, settings);
  release(); await first;
  await vi.advanceTimersByTimeAsync(300);
  expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 2; i++) expect(Math.abs(Number(send.mock.calls[1][i]) - Number(send.mock.calls[0][i]))).toBeLessThanOrEqual(6);
  c.cancel();
});
