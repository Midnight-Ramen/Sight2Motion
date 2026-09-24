import { displayedX } from './CameraOrientation';
export interface SelectedSegment {
  displayName?: string;
  detectorLabel?: string | null;
  /** Source-frame pixel coordinates; never feeds robot rules. */
  mask: Uint8Array;
  width: number; height: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  centroid: { x: number; y: number };
  area: number;
}
export function sourceClick(x: number, y: number, displayWidth: number, displayHeight: number,
  width: number, height: number, mirror: boolean) {
  const scale = Math.min(displayWidth / width, displayHeight / height);
  const px = (x - (displayWidth - width * scale) / 2) / scale;
  const py = (y - (displayHeight - height * scale) / 2) / scale;
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  return { x: Math.min(width - 1, displayedX(px, width, mirror)), y: py };
}
export function summarizeMask(mask: Uint8Array, width: number, height: number): SelectedSegment {
  if (mask.length !== width * height) throw new Error('Invalid mask dimensions.');
  let area = 0, sx = 0, sy = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    area++; sx += x + 0.5; sy += y + 0.5;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!area) throw new Error('No object found at that point. Try another point.');
  return { mask, width, height, area, centroid: { x: sx / area, y: sy / area },
    boundingBox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}
