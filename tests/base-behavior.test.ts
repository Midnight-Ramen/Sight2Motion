import { expect, it, vi } from 'vitest';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import type { ActionEngine } from '../src/core/ActionEngine';
import { makeRule } from '../src/core/types';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
it('does not mistake an asynchronous base startup for a rule reaction', async () => {
  const { coordinator, driver, engine } = setup();
  let complete!: (value: boolean) => void;
  driver.start.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  coordinator.arm(driver);
  engine.busy = true;
  await coordinator.update([], []);
  expect(driver.suspend).not.toHaveBeenCalled();
  expect(engine.updateRules).not.toHaveBeenCalled();
  engine.busy = false;
  complete(true); await settle();
  expect(coordinator.active).toBe(true);
});
function setup() {
  const engine = { busy: false, updateRules: vi.fn(async () => true), stop: vi.fn(async () => {}) };
  const coordinator = new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
  const driver = { safe: vi.fn(() => true), start: vi.fn(async () => true), suspend: vi.fn() };
  return { engine, coordinator, driver };
}
it('does not release base ownership on an empty evaluation; interrupts and resumes for reactions', async () => {
  const { coordinator, driver, engine } = setup();
  coordinator.arm(driver); await settle();
  await coordinator.update([], []);
  expect(engine.updateRules).not.toHaveBeenCalled();
  const rule = makeRule();
  await coordinator.update([rule], [rule]);
  expect(driver.suspend).toHaveBeenCalledTimes(1);
  expect(driver.start).toHaveBeenCalledTimes(1);
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(2);
});
it.each(['STOP', 'manual takeover', 'disconnect'])('never resumes after %s during a pending reaction', async () => {
  const { coordinator, driver, engine } = setup();
  let complete!: (value: boolean) => void;
  coordinator.arm(driver); await settle();
  engine.updateRules.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const rule = makeRule();
  const reaction = coordinator.update([rule], [rule]); await settle();
  coordinator.disarm(); complete(true); await reaction;
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(1);
  expect(coordinator.enabled).toBe(false);
});
it('waits for pending rule completion and safe sensors before resuming', async () => {
  const { coordinator, driver, engine } = setup();
  let complete!: (value: boolean) => void;
  coordinator.arm(driver); await settle();
  engine.updateRules.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const rule = makeRule();
  const reaction = coordinator.update([rule], [rule]); await settle();
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(1);
  driver.safe.mockReturnValue(false);
  complete(true); await reaction;
  expect(driver.start).toHaveBeenCalledTimes(1);
  expect(coordinator.enabled).toBe(false);
});
it('gives emergency braking priority over both rules and base and requires rearming', async () => {
  const { coordinator, driver, engine } = setup();
  coordinator.arm(driver); await settle();
  coordinator.safety = () => false;
  await coordinator.update([makeRule()], []);
  expect(engine.stop).toHaveBeenCalled();
  expect(engine.updateRules).not.toHaveBeenCalled();
  coordinator.safety = () => true;
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(1);
});
it('resumes after a temporary appearance reaction completes while the object is still visible', async () => {
  const { coordinator, driver, engine } = setup();
  let complete!: (value: boolean) => void;
  coordinator.arm(driver); await settle();
  engine.updateRules.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const rule = { ...makeRule(), mode: 'appearance' as const };
  const reaction = coordinator.update([rule], [rule]); await settle();
  await coordinator.update([], [rule]);
  expect(driver.start).toHaveBeenCalledTimes(1);
  complete(true); await reaction;
  expect(driver.start).toHaveBeenCalledTimes(2);
});
it('disarms a running base when its required sensors become unsafe', async () => {
  const { coordinator, driver, engine } = setup();
  coordinator.arm(driver); await settle();
  driver.safe.mockReturnValue(false);
  await coordinator.update([], []);
  expect(engine.stop).toHaveBeenCalled();
  expect(coordinator.enabled).toBe(false);
  driver.safe.mockReturnValue(true);
  await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(1);
});
