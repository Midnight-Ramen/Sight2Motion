import type { VisionResult, DetectionRegion, DetectionDistance } from './types';
import { matchesDistance, DEFAULT_NEAR_THRESHOLD } from './DetectionDistance';
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
    detections: VisionResult[],
    className: string,
    threshold: number,
    now: number,
    region: DetectionRegion = 'anywhere',
    distance: DetectionDistance = 'any',
    nearThreshold: number = DEFAULT_NEAR_THRESHOLD,
  ): DetectionState {
    const visible = detections.some((d) => d.className === className && d.confidence >= threshold &&
      (region === 'anywhere' || d.region === region) && matchesDistance(d, distance, nearThreshold));
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

