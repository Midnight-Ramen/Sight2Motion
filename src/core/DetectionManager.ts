import { hasBoundingBox, type Rule, type VisionResult, type DetectionRegion, type DetectionDistance } from './types';
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
    graceMs = 0,
  ): DetectionState {
    const seen = detections.some((d) => d.className === className && d.confidence >= threshold &&
      (region === 'anywhere' || d.region === region) && matchesDistance(d, distance, nearThreshold));
    const old = this.states.get(key);
    const visible = seen || !!(old?.visible && now - old.lastSeen < graceMs);
    const state = {
      visible,
      appeared: visible && !old?.visible,
      disappeared: !visible && !!old?.visible,
      since: visible && old?.visible ? old.since : visible ? now : (old?.since ?? now),
      lastSeen: seen ? now : (old?.lastSeen ?? now),
    };
    this.states.set(key, state);
    return state;
  }
  reset() {
    this.states.clear();
  }
}


/** Normalize qualifying boxes once, independently of local/network frame sources. */
export function followTargets(rule: Rule, detections: VisionResult[], width: number, height: number) {
  if (!(width > 0 && height > 0)) return [];
  return detections.filter(hasBoundingBox).filter(d => d.className === rule.className &&
    d.confidence >= rule.confidence && (rule.region === 'anywhere' || d.region === rule.region) &&
    matchesDistance(d, rule.distance, rule.nearThreshold) &&
    [d.x, d.y, d.width, d.height].every(Number.isFinite) && d.width > 0 && d.height > 0)
    .map(d => ({ x: d.x / width, y: d.y / height, width: d.width / width, height: d.height / height }));
}
