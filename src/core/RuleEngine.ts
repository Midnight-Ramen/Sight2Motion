import { FOLLOW_DEFAULTS } from './FollowController';
import { DetectionManager } from './DetectionManager';
import type { VisionResult, Rule } from './types';
import { ruleSource } from './types';
import { compatibleRule, YOLO_CAPABILITIES, type VisionCapabilities } from './VisionCapabilities';
import { SENSOR_MAX_AGE, sensorMatches, isFinchSensor, type SensorState, type SensorDescriptor } from './Sensors';
export class RuleEngine {
  private detection = new DetectionManager();
  private sensorPresence = new Map<string, { visible: boolean; since: number }>();
  /** Currently visible and initially qualified; independent of trigger cooldown. */
  activeRules: Rule[] = [];
  private results: Record<string, 'TRUE' | 'FALSE' | 'Waiting'> = {};
  get diagnostics(): Readonly<Record<string, 'TRUE' | 'FALSE' | 'Waiting'>> { return { ...this.results }; }
  private states = new Map<string, { fired: boolean; qualified: boolean; last: number }>();
  reset() {
    this.detection.reset();
    this.sensorPresence.clear();
    this.states.clear();
    this.activeRules = [];
    this.results = {};
  }
  evaluate(rules: Rule[], detections: VisionResult[], now: number, capabilities: VisionCapabilities = YOLO_CAPABILITIES,
    sensors: { state: SensorState; configuration: SensorDescriptor[]; available: boolean } = { state: {}, configuration: [], available: false }): Rule[] {
    const result: Rule[] = [];
    this.results = {};
    this.activeRules = [];
    for (const rule of rules) {
      if (!rule.enabled || !compatibleRule(rule, capabilities)) continue;
      const source = ruleSource(rule);
      const conditions = source === 'vision' ? [] : rule.sensorConditions ?? [];
      const sensorReady = (source === 'vision' || conditions.length > 0) && conditions.every(condition => {
        const sample = sensors.state[condition.sensorId];
        return sensors.available && sensors.configuration.some(sensor => sensor.id === condition.sensorId &&
          (isFinchSensor(sensor.type) || ['distance', 'light', 'sound', 'analog', 'digital'].includes(sensor.type))) &&
          !!sample?.reading && now >= sample.updatedAt && now - sample.updatedAt <= SENSOR_MAX_AGE;
      });
      const sensorPass = sensorReady && conditions.every(condition => sensorMatches(condition, sensors.state, now));
      const previous = this.sensorPresence.get(rule.id);
      const sensorPresence = { visible: sensorPass, since: sensorPass && previous?.visible ? previous.since : now,
        appeared: sensorPass && !previous?.visible, disappeared: !sensorPass && !!previous?.visible };
      if (source === 'sensor') this.sensorPresence.set(rule.id, sensorPresence);
      const presence = source === 'sensor' ? sensorPresence : this.detection.update(
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
      this.results[rule.id] = !sensorReady ? 'Waiting' : presence.visible ? state.qualified ? 'TRUE' : 'Waiting' : 'FALSE';
      const ready =
        now - state.last >= Math.max(rule.cooldown, rule.mode === 'interval' ? rule.interval : 0);
      const trigger =
        rule.mode === 'disappearance'
          ? presence.disappeared && state.qualified
          : presence.visible && state.qualified && (rule.mode !== 'appearance' || !state.fired);
      if (trigger && ready && (source === 'sensor' ? sensorReady : sensorPass)) {
        result.push(rule);
        state.last = now;
        state.fired = true;
      }
      this.states.set(rule.id, state);
    }
    return result;
  }
}

