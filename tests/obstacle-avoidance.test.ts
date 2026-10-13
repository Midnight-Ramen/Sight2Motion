import { expect, it, vi } from 'vitest';
import { ObstacleAvoidance, OBSTACLE_AVOIDANCE } from '../src/core/ObstacleAvoidance';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import type { ActionEngine } from '../src/core/ActionEngine';
import type { NavigationCommand } from '../src/core/FinchNavigation';
import type { SensorState } from '../src/core/Sensors';
import { makeRule } from '../src/core/types';

function setup(left = 60, right = 35, final = 40) {
  let now = 100, allowed = true;
  let sensors: SensorState = { finchDistance: { reading: { kind: 'number', value: 20 }, updatedAt: now } };
  const commands: NavigationCommand[] = [], statuses: string[] = [], phases: string[] = [];
  const stop = vi.fn(async () => {});
  const move = vi.fn(async (command: NavigationCommand, _signal: AbortSignal) => {
    commands.push(command); now += 10;
    const index = commands.length;
    setTimeout(() => {
      const value = index === 1 ? left : index === 2 ? right : final;
      now += 1; sensors = { finchDistance: { reading: { kind: 'number', value }, updatedAt: now } };
      avoidance.sensorsUpdated();
    }, 0);
    return true;
  });
  const avoidance = new ObstacleAvoidance({ sensors: () => sensors, now: () => now,
    allowed: () => allowed, stop, move, phaseChanged: phase => phases.push(phase), status: message => statuses.push(message) }, 20,
    { ...OBSTACLE_AVOIDANCE, freshReadingTimeoutMs: 50 });
  return { avoidance, commands, statuses, phases, stop, move, setAllowed: (value: boolean) => { allowed = value; },
    advance: (ms: number) => { now += ms; },
    publish: (value: number, age = 0) => { now += 1; sensors = { finchDistance: { reading: { kind: 'number', value }, updatedAt: now - age } }; avoidance.sensorsUpdated(); } };
}
it('threshold includes equality and triggers once until threshold plus hysteresis clears', async () => {
  const { avoidance, publish, advance } = setup(); expect(avoidance.shouldTrigger()).toBe(true);
  await avoidance.run(); publish(20); expect(avoidance.shouldTrigger()).toBe(false);
  publish(23); expect(avoidance.shouldTrigger()).toBe(false);
  publish(25); expect(avoidance.shouldTrigger()).toBe(false);
  publish(26); expect(avoidance.shouldTrigger()).toBe(false);
  advance(500); publish(26); expect(avoidance.shouldTrigger()).toBe(false);
  publish(20); expect(avoidance.shouldTrigger()).toBe(true);
});
it.each([['left', 60, 35], ['right', 35, 60]] as const)('chooses greater clearance and performs %s calibrated bypass', async (side, left, right) => {
  const { avoidance, commands, statuses } = setup(left, right);
  expect(await avoidance.run()).toBe(true);
  expect(commands).toEqual([
    { kind: 'turn', direction: 'left', amount: 30 },
    { kind: 'turn', direction: 'right', amount: 60 },
    { kind: 'turn', direction: 'left', amount: 30 },
    { kind: 'turn', direction: side, amount: 45 },
    { kind: 'distance', direction: 'forward', amount: 25 },
    { kind: 'turn', direction: side === 'left' ? 'right' : 'left', amount: 45 },
    { kind: 'distance', direction: 'forward', amount: 30 },
    { kind: 'turn', direction: side === 'left' ? 'right' : 'left', amount: 45 },
    { kind: 'distance', direction: 'forward', amount: 25 },
    { kind: 'turn', direction: side, amount: 45 },
  ]);
  expect(statuses).toContain(`Bypassing ${side}`);
});
it('blocked scan returns to original heading then STOPs without bypass', async () => {
  const { avoidance, commands, statuses, stop } = setup(20, 23);
  expect(await avoidance.run()).toBe(false); expect(commands).toHaveLength(3);
  expect(statuses.at(-1)).toBe('Path blocked'); expect(stop).toHaveBeenCalledTimes(2);
});
it('requires new post-turn readings, rejecting cached and stale samples', async () => {
  const { avoidance, move, publish, commands, stop } = setup();
  move.mockImplementationOnce(async command => { commands.push(command); publish(60, 800); return true; });
  expect(await avoidance.run()).toBe(false);
  expect(commands).toHaveLength(1); expect(stop).toHaveBeenCalledTimes(2);
});
it('navigation safety failure stops and never completes bypass', async () => {
  const { avoidance, move, stop } = setup(); move.mockResolvedValueOnce(false);
  expect(await avoidance.run()).toBe(false); expect(stop).toHaveBeenCalledTimes(2);
});
it('unsafe restored front clearance prevents cruise resume', async () => {
  const { avoidance, statuses } = setup(60, 35, 15);
  expect(await avoidance.run()).toBe(false); expect(statuses.at(-1)).toBe('Path blocked');
});
it('freshness wait is cancelled immediately, without another sensor poll', async () => {
  const { avoidance, move, commands } = setup();
  move.mockImplementationOnce(async command => { commands.push(command); return true; });
  const run = avoidance.run(); for (let i = 0; i < 5; i++) await Promise.resolve();
  avoidance.cancel(); expect(await run).toBe(false); expect(commands).toHaveLength(1);
});
function arbitration() {
  const engine = { busy: false, updateRules: vi.fn(async () => true), stop: vi.fn(async () => {}) };
  const coordinator = new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
  const driver = { safe: () => true, start: vi.fn(async () => true), suspend: vi.fn(async () => {}) };
  let complete!: (ok: boolean) => void;
  const assist = { shouldTrigger: vi.fn(() => true), run: vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; })), cancel: vi.fn(), reset: vi.fn() };
  coordinator.assist = assist; coordinator.arm(driver);
  return { coordinator, engine, driver, assist, finish: (ok: boolean) => complete(ok) };
}
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
it('avoidance outranks reactions, holds ownership, then Cruise resumes after success', async () => {
  const { coordinator, engine, driver, assist, finish } = arbitration(); await settle();
  await coordinator.update([makeRule()], []); await settle();
  expect(coordinator.avoiding).toBe(true); expect(engine.updateRules).not.toHaveBeenCalled();
  await coordinator.update([makeRule()], []); expect(assist.run).toHaveBeenCalledTimes(1);
  assist.shouldTrigger.mockReturnValue(false); finish(true); await settle();
  await coordinator.update([], []); expect(driver.start).toHaveBeenCalledTimes(2);
});
it.each(['global STOP', 'manual takeover', 'disconnect'])('%s cancels avoidance and prevents delayed resume', async () => {
  const { coordinator, driver, assist, finish } = arbitration(); await settle();
  await coordinator.update([], []); await settle(); coordinator.disarm(); finish(true); await settle();
  await coordinator.update([], []); expect(driver.start).toHaveBeenCalledTimes(1);
  expect(assist.cancel).toHaveBeenCalled(); expect(coordinator.enabled).toBe(false);
});
it('emergency braking interrupts avoidance ahead of reactions and prevents resume', async () => {
  const { coordinator, driver, engine, finish } = arbitration(); await settle();
  await coordinator.update([], []); await settle(); coordinator.safety = () => false;
  await coordinator.update([makeRule()], []); finish(true); await settle();
  expect(engine.stop).toHaveBeenCalled(); expect(coordinator.enabled).toBe(false);
  coordinator.safety = () => true; await coordinator.update([], []); expect(driver.start).toHaveBeenCalledTimes(1);
});
it('blocked result disarms, requiring another Play', async () => {
  const { coordinator, driver, finish } = arbitration(); await settle();
  await coordinator.update([], []); await settle(); finish(false); await settle();
  await coordinator.update([], []); expect(coordinator.enabled).toBe(false); expect(driver.start).toHaveBeenCalledTimes(1);
});

it('uses the existing navigation/provider instead of introducing another poll or motor loop', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/core/ObstacleAvoidance.ts', 'utf8');
  const component = readFileSync('src/components/BaseDrivingControls.tsx', 'utf8');
  expect(source).not.toMatch(/setInterval|setWheelSpeeds|fetch\(/);
  expect(component).toContain('avoidanceNavigation.start(command');
  expect(component).not.toContain('provider?.start(');
  expect(component).not.toContain('Start avoidance');
});

it('condition clearing and oscillating during scan cannot restart or cancel the latched assist', async () => {
  const { coordinator, engine, driver, assist, finish } = arbitration(); await settle();
  await coordinator.update([makeRule()], [makeRule()]); await settle();
  for (const active of [[], [makeRule()], [], [makeRule()], []]) await coordinator.update([], active);
  expect(coordinator.avoiding).toBe(true); expect(coordinator.enabled).toBe(true);
  expect(assist.run).toHaveBeenCalledTimes(1); expect(driver.start).toHaveBeenCalledTimes(1);
  expect(engine.updateRules).not.toHaveBeenCalled();
  assist.shouldTrigger.mockReturnValue(false); finish(true); await settle();
  await coordinator.update([], []); expect(driver.start).toHaveBeenCalledTimes(2);
});
it('rearm requires strictly threshold +5 and 500 ms uninterrupted fresh clearance', async () => {
  const { avoidance, publish, advance } = setup(); await avoidance.run();
  publish(25); avoidance.shouldTrigger(); advance(600); publish(25); avoidance.shouldTrigger();
  publish(20); expect(avoidance.shouldTrigger()).toBe(false);
  publish(26); avoidance.shouldTrigger(); advance(499); publish(26); avoidance.shouldTrigger();
  publish(24); avoidance.shouldTrigger(); // Oscillation resets the clearance timer.
  publish(26); avoidance.shouldTrigger(); advance(500); publish(26); avoidance.shouldTrigger();
  publish(20); expect(avoidance.shouldTrigger()).toBe(true);
});
it('stale clearance cannot accumulate rearm time', async () => {
  const { avoidance, publish, advance } = setup(); await avoidance.run();
  publish(30); avoidance.shouldTrigger(); advance(1000); publish(30, 800); avoidance.shouldTrigger();
  publish(20); expect(avoidance.shouldTrigger()).toBe(false);
});

it('exposes every ordered phase through complete calibrated bypass', async () => {
  const { avoidance, phases } = setup(); expect(await avoidance.run()).toBe(true);
  expect(phases).toEqual(['STOPPING', 'SCAN_LEFT_TURN', 'SCAN_LEFT_SAMPLE', 'SCAN_RIGHT_TURN',
    'SCAN_RIGHT_SAMPLE', 'RETURN_CENTER', 'CHOOSE_SIDE', 'BYPASS_TURN', 'BYPASS_DRIVE', 'REALIGN', 'PASS_DRIVE', 'RETURN_TURN', 'RETURN_DRIVE', 'FINAL_REALIGN', 'COMPLETE']);
});
it('waits for new samples through pre-turn expiry while stationary, then applies forward braking', async () => {
  let now = 1000;
  let state: SensorState = { finchDistance: { reading: { kind: 'number', value: 18 }, updatedAt: now } };
  const moves: NavigationCommand[] = [];
  const avoidance = new ObstacleAvoidance({
    sensors: () => state, now: () => now, allowed: () => true, stop: async () => {}, status: () => {},
    unsafe: forward => forward && (state.finchDistance.reading!.value as number) <= 10 ? 'emergency braking: unsafe forward clearance' : undefined,
    move: async command => {
      moves.push(command); now += 900; // Old sample crosses 750ms during a stationary turn.
      setTimeout(() => { now += 1; state = { finchDistance: { reading: { kind: 'number', value: moves.length === 1 ? 8 : 60 }, updatedAt: now } }; avoidance.sensorsUpdated(); }, 10);
      return true;
    },
  }, 20, { ...OBSTACLE_AVOIDANCE, freshReadingTimeoutMs: 100 });
  expect(await avoidance.run()).toBe(true);
  expect(moves).toHaveLength(10); expect(avoidance.phase).toBe('COMPLETE');
});
it('sample timeout stops and reports the exact sample phase', async () => {
  const { avoidance, move, commands } = setup();
  move.mockImplementationOnce(async command => { commands.push(command); return true; });
  expect(await avoidance.run()).toBe(false);
  expect(avoidance.phase).toBe('ABORTED');
  expect(avoidance.abortReason).toBe('stale distance: no new sample during SCAN_LEFT_SAMPLE');
});
it('fresh unsafe forward clearance aborts before any bypass drive', async () => {
  let now = 100, state: SensorState = { finchDistance: { reading: { kind: 'number', value: 18 }, updatedAt: 100 } };
  const moves: NavigationCommand[] = [];
  const avoidance = new ObstacleAvoidance({
    sensors: () => state, now: () => now, allowed: () => true, stop: async () => {}, status: () => {},
    unsafe: forward => forward && (state.finchDistance.reading!.value as number) <= 10 ? 'emergency braking: unsafe forward clearance' : undefined,
    move: async command => {
      moves.push(command); now += 10;
      setTimeout(() => { now += 1; state = { finchDistance: { reading: { kind: 'number', value: moves.length === 4 ? 8 : 60 }, updatedAt: now } }; avoidance.sensorsUpdated(); }, 0);
      return true;
    },
  }, 20, { ...OBSTACLE_AVOIDANCE, freshReadingTimeoutMs: 100 });
  expect(await avoidance.run()).toBe(false);
  expect(moves.every(command => command.kind === 'turn')).toBe(true);
  expect(avoidance.phase).toBe('ABORTED'); expect(avoidance.abortReason).toContain('emergency braking');
});
it('global cancel during sample wait exposes reason and cannot advance', async () => {
  const { avoidance, move, commands } = setup(); move.mockImplementationOnce(async command => { commands.push(command); return true; });
  const run = avoidance.run(); for (let i = 0; i < 10; i++) await Promise.resolve();
  avoidance.cancel('global STOP'); expect(await run).toBe(false);
  expect(avoidance.abortReason).toBe('global STOP'); expect(avoidance.phase).toBe('ABORTED'); expect(commands).toHaveLength(1);
});
it.each([[60, 35], [35, 60]])('returns to the original path and heading for either chosen side', async (left, right) => {
  const { avoidance, commands } = setup(left, right);
  expect(await avoidance.run()).toBe(true);
  let heading = 0, lateral = 0, forward = 0;
  for (const command of commands) {
    if (command.kind === 'turn') heading += command.direction === 'left' ? command.amount : -command.amount;
    else { lateral += Math.sin(heading * Math.PI / 180) * command.amount; forward += Math.cos(heading * Math.PI / 180) * command.amount; }
  }
  expect(heading).toBe(0);
  expect(lateral).toBeCloseTo(0);
  expect(forward).toBeCloseTo(30 + 50 * Math.cos(Math.PI / 4));
});
it('blocked return leg stops without executing the inward drive or resuming', async () => {
  const { avoidance, move, commands, publish, advance } = setup();
  move.mockImplementation(async command => {
    commands.push(command); advance(10);
    setTimeout(() => publish(avoidance.phase === 'RETURN_DRIVE' ? 8 : 60), 0);
    return true;
  });
  expect(await avoidance.run()).toBe(false);
  expect(commands).toHaveLength(8);
  expect(avoidance.failedPhase).toBe('RETURN_DRIVE');
  expect(avoidance.abortReason).toBe('path blocked');
});
