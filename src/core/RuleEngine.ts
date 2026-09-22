import { FOLLOW_DEFAULTS } from './FollowController';
import { DetectionManager } from './DetectionManager';
import type { VisionResult, Rule } from './types';
import { compatibleRule, YOLO_CAPABILITIES, type VisionCapabilities } from './VisionCapabilities';
import { sensorMatches, type SensorState, type SensorDescriptor } from './Sensors';
export class RuleEngine {
  private detection = new DetectionManager();
  /** Currently visible and initially qualified; independent of trigger cooldown. */
  activeRules: Rule[] = [];
  private states = new Map<string, { fired: boolean; qualified: boolean; last: number }>();
  reset() {
    this.detection.reset();
    this.states.clear();
    this.activeRules = [];
  }
  evaluate(rules: Rule[], detections: VisionResult[], now: number, capabilities: VisionCapabilities = YOLO_CAPABILITIES,
    sensors: { state: SensorState; configuration: SensorDescriptor[]; available: boolean } = { state: {}, configuration: [], available: false }): Rule[] {
    const result: Rule[] = [];
    this.activeRules = [];
    for (const rule of rules) {
      if (!rule.enabled || !compatibleRule(rule, capabilities)) continue;
      const sensorPass = (rule.sensorConditions ?? []).every(condition => sensors.available &&
        sensors.configuration.some(sensor => sensor.id === condition.sensorId) && sensorMatches(condition, sensors.state, now));
      const presence = this.detection.update(
        rule.id,
        sensorPass ? detections : [],
        rule.className,
        rule.confidence,
        now,
        rule.region ?? 'anywhere',
        rule.distance ?? 'any',
        rule.nearThreshold,
        sensorPass ? Math.max(0, ...rule.actions.filter(a => a.enabled && a.kind === 'move' && a.mode === 'follow')
          .map(a => a.lostTargetTimeoutMs ?? FOLLOW_DEFAULTS.lostTargetTimeoutMs)) : 0,
      );
      const state = this.states.get(rule.id) ?? { fired: false, qualified: false, last: -Infinity };
      if (presence.appeared) {
        state.fired = false;
        state.qualified = false;
      }
      if (presence.visible && now - presence.since >= rule.minDuration) state.qualified = true;
      if (presence.visible && state.qualified) this.activeRules.push(rule);
      const ready =
        now - state.last >= Math.max(rule.cooldown, rule.mode === 'interval' ? rule.interval : 0);
      const trigger =
        rule.mode === 'disappearance'
          ? presence.disappeared && state.qualified
          : presence.visible && state.qualified && (rule.mode !== 'appearance' || !state.fired);
      if (trigger && ready && sensorPass) {
        result.push(rule);
        state.last = now;
        state.fired = true;
      }
      this.states.set(rule.id, state);
    }
    return result;
  }
}

