import type { Detection, DetectionDistance, VisionResult } from './types';

export const DEFAULT_NEAR_THRESHOLD = 0.12;

/** Apparent frame coverage, not physical distance. Uses the original camera dimensions. */
export function detectionAreaRatio(box: Pick<Detection, 'width' | 'height'>, frameWidth: number, frameHeight: number): number {
  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0)
    throw new Error('Positive frame dimensions are required.');
  return (box.width * box.height) / (frameWidth * frameHeight);
}

export function matchesDistance(detection: VisionResult, distance: DetectionDistance = 'any', nearThreshold = DEFAULT_NEAR_THRESHOLD): boolean {
  if (distance === 'any') return true;
  const size = detection.areaRatio;
  if (size === undefined || !Number.isFinite(size) || size < 0) return false;
  return distance === 'near' ? size >= nearThreshold : size < nearThreshold;
}
