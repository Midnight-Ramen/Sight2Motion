import { hasBoundingBox, type VisionResult } from './types';

/** Display-space horizontal position. A point has width zero; a box has its own width. */
export function displayedX(x: number, frameWidth: number, mirrorHorizontal: boolean, width = 0): number {
  return mirrorHorizontal ? frameWidth - x - width : x;
}

/** Apply once, before regions, overlays, and Follow consume detections. */
export function orientDetections(items: VisionResult[], frameWidth: number, mirrorHorizontal: boolean): VisionResult[] {
  return items.map(d => hasBoundingBox(d) ? {
    ...d,
    x: displayedX(d.x, frameWidth, mirrorHorizontal, d.width),
    centerX: displayedX(d.centerX, frameWidth, mirrorHorizontal),
  } : d);
}
