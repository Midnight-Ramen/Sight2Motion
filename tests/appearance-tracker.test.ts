import { expect, it } from 'vitest';
import { AppearanceTracker } from '../src/core/AppearanceTracker';
import { summarizeMask } from '../src/core/SegmentationGeometry';
const width = 100, height = 80;
function frame(dx = 0, missing = false) {
  const data = new Uint8ClampedArray(width * height * 4).fill(30);
  if (!missing) for (let y = 25; y < 49; y++) for (let x = 30; x < 50; x++) {
    const i = (y * width + x + dx) * 4;
    data[i] = 80 + (x % 5) * 25; data[i + 1] = 150 + (y % 4) * 20; data[i + 2] = 40;
  }
  return { data, width, height };
}
function start(mirror = false) {
  const mask = new Uint8Array(width * height);
  for (let y = 25; y < 49; y++) for (let x = 30; x < 50; x++) mask[y * width + x] = 1;
  const tracker = new AppearanceTracker();
  tracker.initialize(frame(), { ...summarizeMask(mask, width, height), displayName: 'My cup' }, mirror);
  return tracker;
}
it('tracks a named SAM appearance without any detector results', () => {
  const tracker = start();
  expect(tracker.update(frame(), 100, width, height)?.displayName).toBe('My cup');
  const next = tracker.update(frame(6), 200, width, height)!;
  expect(next.state).toBe('TRACKING'); expect(next.centerX).toBeCloseTo(46, 0);
  expect(next.detectorClassId).toBeNull();
});
it('mirrors geometry once and preserves target area', () => {
  const a = start().update(frame(), 100, width, height)!;
  const b = start(true).update(frame(), 100, width, height)!;
  expect(b.centerX).toBeCloseTo(width - a.centerX);
  expect(b.horizontalError).toBeCloseTo(-a.horizontalError);
  expect(b.normalizedArea).toBe(a.normalizedArea);
});
it('does not refresh a missing target and requires reselection after loss', () => {
  const tracker = start(); tracker.update(frame(), 100, width, height);
  expect(tracker.update(frame(0, true), 200, width, height)?.state).toBe('TEMPORARILY_LOST');
  expect(tracker.capturedAt).toBe(100);
  expect(tracker.age(900)?.targetLost).toBe(true);
  expect(tracker.update(frame(), 1000, width, height)?.targetLost).toBe(true);
});
it('ignores duplicate timestamps and clears on stop', () => {
  const tracker = start(); tracker.update(frame(), 100, width, height);
  tracker.update(frame(6), 100, width, height);
  expect(tracker.capturedAt).toBe(100);
  tracker.stop(); expect(tracker.age()).toBeNull();
});
import { parseProject } from '../src/core/ProjectStorage';
import { makeProject } from '../src/core/types';
it('persists names only and validates imported custom names', () => {
  const project = { ...makeProject(), customObjects: ['My cup', 'My cup', 'Gearbox'] };
  expect(parseProject(JSON.stringify(project)).customObjects).toEqual(['My cup', 'Gearbox']);
  expect(() => parseProject(JSON.stringify({ ...project, customObjects: [''] }))).toThrow();
  expect(() => parseProject(JSON.stringify({ ...project, customObjects: Array(11).fill('cup') }))).toThrow();
});
import { TRACKED_FOLLOW_DEFAULTS, trackedFollowCommand } from '../src/core/FollowController';
it('feeds mirrored appearance geometry into existing Follow wheel steering', () => {
  const a = start().update(frame(), 100, width, height)!;
  const b = start(true).update(frame(), 100, width, height)!;
  const left = trackedFollowCommand(a, TRACKED_FOLLOW_DEFAULTS);
  const right = trackedFollowCommand(b, TRACKED_FOLLOW_DEFAULTS);
  expect(left.left).toBeLessThan(left.right);
  expect(right.left).toBeGreaterThan(right.right);
});
it('rejects featureless ambiguous images instead of claiming a lock', () => {
  const mask = new Uint8Array(width * height).fill(1);
  const tracker = new AppearanceTracker();
  const image = frame(0, true);
  const selection = summarizeMask(mask, width, height);
  selection.boundingBox = {x: 30, y: 25, width: 20, height: 24};
  tracker.initialize(image, selection, false);
  expect(tracker.update(image, 100, width, height)).toBeNull();
});
