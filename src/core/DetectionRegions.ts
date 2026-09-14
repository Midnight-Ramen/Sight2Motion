import type { Detection, DetectionRegion } from './types';
export const REGION_BOUNDARIES = [1 / 3, 2 / 3] as const;
export function detectionRegion(box: Pick<Detection, 'x' | 'width'>, frameWidth: number): Exclude<DetectionRegion, 'anywhere'> {
  if (!Number.isFinite(frameWidth) || frameWidth <= 0) throw new Error('A positive frame width is required.');
  const normalizedX = (box.x + box.width / 2) / frameWidth;
  return normalizedX < REGION_BOUNDARIES[0] ? 'left' : normalizedX < REGION_BOUNDARIES[1] ? 'center' : 'right';
}
export function withDetectionRegions(detections: Detection[], frameWidth: number): Detection[] {
  return detections.map(d => ({ ...d, region: detectionRegion(d, frameWidth) }));
}
