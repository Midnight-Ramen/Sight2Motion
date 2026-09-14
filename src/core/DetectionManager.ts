import type { Detection, DetectionRegion } from './types';
export interface DetectionState {
  since: number;
  lastSeen: number;
  visible: boolean;
  appeared: boolean;
  disappeared: boolean;
}
/** Class-level presence, deliberately not individual-object tracking. */
export class DetectionManager {
  private states = new Map<string, DetectionState>();
  update(
    key: string,
    detections: Detection[],
    className: string,
    threshold: number,
    now: number,
    region: DetectionRegion = 'anywhere',
  ): DetectionState {
    const visible = detections.some((d) => d.className === className && d.confidence >= threshold && (region === 'anywhere' || d.region === region));
    const old = this.states.get(key);
    const state = {
      visible,
      appeared: visible && !old?.visible,
      disappeared: !visible && !!old?.visible,
      since: visible && old?.visible ? old.since : visible ? now : (old?.since ?? now),
      lastSeen: visible ? now : (old?.lastSeen ?? now),
    };
    this.states.set(key, state);
    return state;
  }
  reset() {
    this.states.clear();
  }
}

