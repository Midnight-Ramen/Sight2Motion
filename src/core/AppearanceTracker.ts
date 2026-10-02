import { displayedX } from './CameraOrientation';
import type { SelectedSegment } from './SegmentationGeometry';
import type { TrackedTarget } from './TargetTracker';

type Pixels = Pick<ImageData, 'data' | 'width' | 'height'>;
type Box = SelectedSegment['boundingBox'];
export const APPEARANCE_STABILITY = { alpha: .65, acquireConfidence: .72, retainConfidence: .67, ambiguityMargin: .035 };
/** Fixed appearance template: never learns background after an uncertain match. */
export class AppearanceTracker {
  readonly lossTimeoutMs = 750;
  private samples: { u: number; v: number; rgb: number[]; weight: number }[] = [];
  private box!: Box;
  private target: TrackedTarget | null = null;
  private lastSeen = -Infinity;
  private lastFrame = -Infinity;
  private width = 0;
  private height = 0;
  private mirror = false;
  private name = '';
  get capturedAt() { return this.lastSeen; }
  stop() { this.target = null; this.samples = []; this.lastSeen = this.lastFrame = -Infinity; }
  initialize(image: Pixels, selection: SelectedSegment, mirror: boolean) {
    this.stop(); this.width = image.width; this.height = image.height; this.mirror = mirror;
    this.name = selection.displayName?.trim() || 'Selected object';
    const sx = image.width / selection.width, sy = image.height / selection.height;
    const b = selection.boundingBox;
    this.box = { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy };
    if (this.box.width < 5 || this.box.height < 5) throw new Error('Select a larger object for appearance tracking.');
    // Include a narrow context band to distinguish a solid cup from a solid wall.
    for (let iy = -1; iy <= 12; iy++) for (let ix = -1; ix <= 12; ix++) {
      const u = (ix + .5) / 12, v = (iy + .5) / 12;
      const x = Math.floor(b.x + u * b.width), y = Math.floor(b.y + v * b.height);
      const inside = x >= 0 && y >= 0 && x < selection.width && y < selection.height && selection.mask[y * selection.width + x];
      const rgb = this.pixel(image, this.box.x + u * this.box.width, this.box.y + v * this.box.height);
      if (rgb) this.samples.push({ u, v, rgb, weight: inside ? 1 : .35 });
    }
    if (this.samples.length < 20) throw new Error('Not enough visible object detail. Capture another frame.');
  }
  private pixel(image: Pixels, x: number, y: number) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const i = (y * image.width + x) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  }
  private score(image: Pixels, b: Box) {
    let error = 0, weight = 0;
    for (const s of this.samples) {
      const rgb = this.pixel(image, b.x + s.u * b.width, b.y + s.v * b.height);
      if (!rgb) return 0;
      error += s.weight * (Math.abs(rgb[0] - s.rgb[0]) + Math.abs(rgb[1] - s.rgb[1]) + Math.abs(rgb[2] - s.rgb[2])) / 3;
      weight += s.weight;
    }
    return Math.max(0, 1 - error / weight / 100);
  }
  update(image: Pixels, now: number, outputWidth: number, outputHeight: number) {
    if (!Number.isFinite(now) || !this.samples.length || now <= this.lastFrame || this.target?.targetLost) return this.age(now);
    if (this.target && now - this.lastSeen >= this.lossTimeoutMs) return this.age(now);
    this.lastFrame = now;
    if (image.width !== this.width || image.height !== this.height) { this.stop(); return null; }
    const b = this.box, radius = Math.max(8, Math.min(24, this.width * .1));
    const candidates: { box: Box; score: number }[] = [];
    for (const scale of [.92, 1, 1.08]) for (let dy = -radius; dy <= radius; dy += 2) for (let dx = -radius; dx <= radius; dx += 2) {
      const box = { x: b.x + dx + b.width * (1 - scale) / 2, y: b.y + dy + b.height * (1 - scale) / 2, width: b.width * scale, height: b.height * scale };
      candidates.push({ box, score: this.score(image, box) });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const other = candidates.find(c => Math.hypot(c.box.x - best.box.x, c.box.y - best.box.y) > Math.max(5, Math.min(b.width, b.height) * .5));
    if (best.score < (this.target ? APPEARANCE_STABILITY.retainConfidence : APPEARANCE_STABILITY.acquireConfidence) ||
      (other && best.score - other.score < APPEARANCE_STABILITY.ambiguityMargin)) {
      if (this.target) this.target = { ...this.target, state: 'TEMPORARILY_LOST', trackingConfidence: 0 };
      return this.age(now);
    }
    this.box = best.box; this.lastSeen = now;
    const sx = outputWidth / this.width, sy = outputHeight / this.height;
    const rawWidth = best.box.width * sx, rawHeight = best.box.height * sy;
    const rawX = displayedX(best.box.x * sx, outputWidth, this.mirror, rawWidth), rawY = best.box.y * sy;
    const old = this.target?.boundingBox, a = APPEARANCE_STABILITY.alpha;
    const width = old ? old.width + a * (rawWidth - old.width) : rawWidth;
    const height = old ? old.height + a * (rawHeight - old.height) : rawHeight;
    const x = old ? old.x + a * (rawX - old.x) : rawX, y = old ? old.y + a * (rawY - old.y) : rawY;
    const centerX = x + width / 2, centerY = y + height / 2;
    const area = width * height / (outputWidth * outputHeight), error = centerX / outputWidth * 2 - 1;
    this.target = { displayName: this.name, label: this.name, detectorLabel: 'appearance', detectorClassId: null,
      active: true, state: 'TRACKING', lastSeenAt: now, centerX, centerY, boundingBox: { x, y, width, height },
      relativeX: centerX / outputWidth, relativeY: centerY / outputHeight, normalizedWidth: width / outputWidth,
      normalizedHeight: height / outputHeight, normalizedArea: area, size: area, errorX: error, horizontalError: error,
      confidence: best.score, trackingConfidence: best.score, lostFrames: 0, targetLost: false };
    return this.target;
  }
  age(now = performance.now()) {
    if (this.target && now - this.lastSeen >= this.lossTimeoutMs)
      this.target = { ...this.target, state: 'LOST', targetLost: true, trackingConfidence: 0 };
    else if (this.target?.state === 'TRACKING' && now - this.lastSeen > 300)
      this.target = { ...this.target, state: 'TEMPORARILY_LOST' };
    return this.target;
  }
}
