import { expect, it, vi } from 'vitest';
import { BaseBehaviorCoordinator } from '../src/core/BaseBehaviorCoordinator';
import type { ActionEngine } from '../src/core/ActionEngine';
import { readFileSync } from 'node:fs';

it.each(['None', 'Cruise Forward', 'Line Follow', 'Keep Distance'])('configuring %s stays paused until the program Play command', async mode => {
  const engine = { busy: false, updateRules: vi.fn(async () => true), stop: vi.fn(async () => {}) };
  const coordinator = new BaseBehaviorCoordinator(engine as unknown as ActionEngine);
  const driver = { start: vi.fn(async () => true), suspend: vi.fn(), safe: () => true };
  coordinator.program = { selected: mode !== 'None', ready: () => true, start: () => {
    if (mode === 'None') coordinator.disarm(); else coordinator.arm(driver);
  } };
  expect(driver.start).not.toHaveBeenCalled();
  expect(coordinator.startProgram()).toBe(true);
  await Promise.resolve();
  expect(driver.start).toHaveBeenCalledTimes(mode === 'None' ? 0 : 1);
  coordinator.disarm(); await coordinator.update([], []);
  expect(driver.start).toHaveBeenCalledTimes(mode === 'None' ? 0 : 1);
});
it('refuses Play when base settings or required sensors are not ready', () => {
  const coordinator = new BaseBehaviorCoordinator({} as ActionEngine);
  const start = vi.fn();
  coordinator.program = { selected: true, ready: () => false, start };
  expect(coordinator.startProgram()).toBe(false);
  expect(start).not.toHaveBeenCalled();
});
it('connects the existing Play entry to the base and removes duplicate start controls', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const base = readFileSync('src/components/BaseDrivingControls.tsx', 'utf8');
  expect(app).toContain('baseCoordinator.startProgram()');
  expect(base).not.toContain('Start base behavior');
  expect(base).toContain('Ready to run');
  expect(base).toContain("if (mode === 'None') { coordinator.disarm(); return; }");
});
