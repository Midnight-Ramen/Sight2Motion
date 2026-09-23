import { expect, it } from 'vitest';
import { displayedX, orientDetections } from '../src/core/CameraOrientation';
import { withDetectionRegions } from '../src/core/DetectionRegions';
import { detectionAreaRatio, matchesDistance } from '../src/core/DetectionDistance';
import { followTargets } from '../src/core/DetectionManager';
import { followWheels } from '../src/core/FollowController';
import { hasBoundingBox, makeAction, makeProject, makeRule, type Detection } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';

const box = (centerX = 128): Detection => ({ className: 'person', confidence: 0.9,
  x: centerX - 32, y: 48, width: 64, height: 96, centerX, centerY: 96, areaRatio: 0.02 });
const orient = (d: Detection, mirror: boolean) => withDetectionRegions(
  orientDetections([d], 640, mirror).filter(hasBoundingBox), 640)[0];

it('keeps normalized x=0.20 with mirror off', () => expect(displayedX(0.2, 1, false)).toBe(0.2));
it('maps normalized x=0.20 to 0.80 with mirror on', () => expect(displayedX(0.2, 1, true)).toBe(0.8));
it('mirrors box and center without changing vertical coordinates or size', () => {
  const raw = box(); const result = orient(raw, true);
  expect(result).toMatchObject({ x: 480, centerX: 512, y: 48, centerY: 96, width: 64, height: 96 });
  expect(raw.x).toBe(96);
});
it.each([[512, 'left'], [128, 'right']] as const)('classifies mirrored center %s as visual %s', (center, region) => {
  expect(orient(box(center), true).region).toBe(region);
});
it.each([128, 512])('Follow steers toward transformed center %s', center => {
  const target = followTargets(makeRule(), [orient(box(center), true)], 640, 480)[0];
  const [left, right] = followWheels(target, { ...makeAction('move'), mode: 'follow' });
  if (center === 128) expect(left).toBeGreaterThan(right);
  else expect(left).toBeLessThan(right);
});
it('preserves area and Near/Far decisions', () => {
  const raw = box(); const mirrored = orient(raw, true);
  expect(detectionAreaRatio(mirrored, 640, 480)).toBe(detectionAreaRatio(raw, 640, 480));
  for (const distance of ['near', 'far'] as const)
    expect(matchesDistance(mirrored, distance)).toBe(matchesDistance(raw, distance));
});
it('leaves nonspatial classification results unchanged', () => {
  const classification = { className: 'person', confidence: 0.9 };
  expect(orientDetections([classification], 640, true)).toEqual([classification]);
});
it.each(['local', 'network'] as const)('round-trips mirror settings for %s and defaults legacy projects to off', cameraSource => {
  for (const mirrorHorizontal of [true, false]) {
    const project = { ...makeProject(), cameraSource, mirrorHorizontal };
    expect(parseProject(JSON.stringify(project)).mirrorHorizontal).toBe(mirrorHorizontal);
  }
  const legacy = { ...makeProject(), cameraSource, mirrorHorizontal: undefined };
  expect(parseProject(JSON.stringify(legacy)).mirrorHorizontal).toBe(false);
  expect(() => parseProject(JSON.stringify({ ...legacy, mirrorHorizontal: 'true' }))).toThrow();
});
