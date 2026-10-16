import { afterEach, expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/core/ActionEngine';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import { FinchNavigation } from '../src/core/FinchNavigation';
import { makeAction, makeRule } from '../src/core/types';
import type { RobotAdapter } from '../src/core/RobotAdapter';
import type { SensorState } from '../src/core/Sensors';

afterEach(() => vi.useRealTimers());
it.each(['stop rule', 'global STOP', 'unsafe sensors'])('keeps line steering through repeated light rules until %s', async ending => {
  vi.useFakeTimers();
  let now = 1000;
  let left = 99, right = 99;
  const sensors = (): SensorState => Object.fromEntries(([['finchLineLeft', left], ['finchLineRight', right]] as const).map(([id, value]) => [id, { reading: { kind: 'number', value }, updatedAt: now }]));
  const robot: RobotAdapter = { connected: true, connect: async () => {}, disconnect: async () => {},
    getCapabilities: () => ['move', 'beak', 'stop'], executeAction: vi.fn(async () => {}), stop: vi.fn(async () => {}), setWheelSpeeds: vi.fn(async () => {}) };
  const engine = new ActionEngine(robot), coordinator = new BaseBehaviorCoordinator(engine);
  const navigation = new FinchNavigation(engine, robot, sensors, () => true, () => {}, () => now);
  const suspend = vi.fn(() => navigation.cancel());
  const start = vi.fn(() => navigation.lineFollow(20, 'stop', true));
  coordinator.arm({ start, suspend, safe: () => true });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const owner = engine.activeMotorOwnerRuleId;
  expect(owner).toBeTruthy();
  vi.mocked(robot.stop).mockClear();
  const light = { ...makeRule(), actions: [makeAction('beak')] };
  for (const pair of [[99, 99], [15, 99], [99, 15]]) {
    [left, right] = pair; now += 100;
    await coordinator.update([light], [light]);
    await navigation.sensorsUpdated(true);
    expect(navigation.lineActive).toBe(true);
    expect(engine.activeMotorOwnerRuleId).toBe(owner);
  }
  expect(robot.executeAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'beak' }), expect.any(AbortSignal));
  expect(robot.setWheelSpeeds).toHaveBeenLastCalledWith(20, 0, 0, expect.any(AbortSignal), 'continuous');
  await coordinator.update([], []);
  expect(engine.activeMotorOwnerRuleId).toBe(owner);
  expect(suspend).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
  expect(robot.stop).not.toHaveBeenCalled();
  if (ending === 'stop rule') {
    const stop = { ...makeRule(), actions: [makeAction('stop')] };
    await coordinator.update([stop], [stop]);
  } else if (ending === 'global STOP') {
    coordinator.disarm(); await engine.stop();
  } else {
    coordinator.safety = () => false;
    await coordinator.update([light], [light]);
  }
  expect(navigation.active).toBe(false);
  expect(robot.stop).toHaveBeenCalled();
  coordinator.disarm(); await engine.waitForStops();
});
