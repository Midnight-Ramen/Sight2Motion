import { makeAction, makeRule, type Action, type DrivingReactionKind, type Rule } from './types';
import type { ActionEngine } from './ActionEngine';
import type { RobotAdapter } from './RobotAdapter';

export interface DrivingOverride { kind: Exclude<DrivingReactionKind, 'resumeBase' | 'avoidObstacle'>; speed: number }
export const isDrivingReaction = (action: Action): boolean =>
  ['slowDown', 'setSpeed', 'veerLeft', 'veerRight', 'resumeBase', 'avoidObstacle'].includes(action.kind);
export function drivingOverride(active: Rule[], triggered: Rule[], suppressed: ReadonlySet<string> = new Set()): DrivingOverride | undefined {
  const actions = active.flatMap(rule => rule.actions).filter(action => action.enabled);
  const entering = triggered.flatMap(rule => rule.actions).filter(action => action.enabled);
  // A stop always wins. Explicit resume wins over temporary speed/steering overrides.
  if ([...actions, ...entering].some(action => action.kind === 'stop' || action.kind === 'resumeBase')) return;
  const action = actions.find(action => ['slowDown', 'setSpeed', 'veerLeft', 'veerRight'].includes(action.kind) && !suppressed.has(action.id));
  return action ? { kind: action.kind as DrivingOverride['kind'], speed: action.speed } : undefined;
}
export const overrideKey = (override?: DrivingOverride) => override ? `${override.kind}:${override.speed}` : '';
export const reactionSpeed = (base: number, override?: DrivingOverride): number =>
  override?.kind === 'slowDown' ? Math.max(1, Math.min(base, override.speed)) :
    override?.kind === 'setSpeed' ? Math.max(1, override.speed) : base;
export const veerWheels = (speed: number, direction: 'veerLeft' | 'veerRight'): [number, number] =>
  direction === 'veerLeft' ? [Math.max(1, speed * 0.4), speed] : [speed, Math.max(1, speed * 0.4)];
/** Custom reactions are handled by the coordinator; adapters retain their existing actions. */
export function engineRules(rules: Rule[], suppressed: ReadonlySet<string> = new Set()): Rule[] {
  return rules.map(rule => {
    const custom = rule.actions.some(action => action.enabled && isDrivingReaction(action));
    return { ...rule, mode: custom && rule.mode === 'continuous' ? 'appearance' as const : rule.mode,
      actions: rule.actions.filter(action => !isDrivingReaction(action) && !(action.kind === 'move' && suppressed.has(action.id))) };
  }).filter(rule => rule.actions.some(action => action.enabled));
}

/** Claim wheels through the same continuous owner used by navigation and Manual Drive. */
export async function startVeer(engine: ActionEngine, robot: RobotAdapter, speed: number,
  direction: 'veerLeft' | 'veerRight', signal: AbortSignal): Promise<boolean> {
  const owner = { ...makeRule(), id: `reaction-${crypto.randomUUID()}`,
    actions: [{ ...makeAction('move'), mode: 'continuous' as const, speed: 0 }] };
  const ok = await engine.updateRules([owner], [owner]);
  if (!ok || signal.aborted || !robot.connected || !robot.setWheelSpeeds) return false;
  await robot.setWheelSpeeds(...veerWheels(speed, direction), 0, signal, 'continuous');
  return !signal.aborted;
}

/** The condition owns detection distance; actions never duplicate a threshold. */
export function avoidanceRuleThreshold(rules: Rule[]): number | undefined {
  for (const rule of rules) {
    if (!rule.enabled || rule.source === 'vision' || (!rule.source && !rule.sensorConditions?.length) ||
      !rule.actions.some(action => action.enabled && action.kind === 'avoidObstacle')) continue;
    const condition = rule.sensorConditions?.find(condition => condition.sensorId === 'finchDistance' &&
      ['lessThan', 'lessThanOrEqual'].includes(condition.operator) && typeof condition.value === 'number' &&
      Number.isFinite(condition.value) && condition.value > 0);
    if (condition) return condition.value as number;
  }
}
