import { DetectionManager } from './DetectionManager';
import type { Detection, Rule } from './types';
export class RuleEngine {
  private detection = new DetectionManager();
  private states = new Map<string, { fired: boolean; qualified: boolean; last: number }>();
  reset() {
    this.detection.reset();
    this.states.clear();
  }
  evaluate(rules: Rule[], detections: Detection[], now: number): Rule[] {
    const result: Rule[] = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const presence = this.detection.update(
        rule.id,
        detections,
        rule.className,
        rule.confidence,
        now,
        rule.region ?? 'anywhere',
      );
      const state = this.states.get(rule.id) ?? { fired: false, qualified: false, last: -Infinity };
      if (presence.appeared) {
        state.fired = false;
        state.qualified = false;
      }
      if (presence.visible && now - presence.since >= rule.minDuration) state.qualified = true;
      const ready =
        now - state.last >= Math.max(rule.cooldown, rule.mode === 'interval' ? rule.interval : 0);
      const trigger =
        rule.mode === 'disappearance'
          ? presence.disappeared && state.qualified
          : presence.visible && state.qualified && (rule.mode !== 'appearance' || !state.fired);
      if (trigger && ready) {
        result.push(rule);
        state.last = now;
        state.fired = true;
      }
      this.states.set(rule.id, state);
    }
    return result;
  }
}

