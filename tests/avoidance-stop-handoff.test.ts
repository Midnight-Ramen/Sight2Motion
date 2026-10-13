import { expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/core/ActionEngine';
import type { RobotAdapter } from '../src/core/RobotAdapter';
it('awaits a navigation STOP delivery without issuing a second STOP or starting early', async () => {
  let complete!: () => void;
  const robot = { stop: vi.fn(() => new Promise<void>(resolve => { complete = resolve; })) };
  const engine = new ActionEngine(robot as unknown as RobotAdapter);
  const stopping = engine.stop(); let nextSegment = false;
  const next = engine.waitForStops().then(() => { nextSegment = true; });
  await Promise.resolve(); expect(nextSegment).toBe(false); expect(robot.stop).toHaveBeenCalledTimes(1);
  complete(); await stopping; await next;
  expect(nextSegment).toBe(true); expect(robot.stop).toHaveBeenCalledTimes(1);
});
it('drains all outstanding STOP deliveries before the next navigation owner', async () => {
  const finishes: (() => void)[] = [];
  const robot = { stop: () => new Promise<void>(resolve => { finishes.push(resolve); }) };
  const engine = new ActionEngine(robot as unknown as RobotAdapter);
  const first = engine.stop(), second = engine.stop(); let ready = false;
  const next = engine.waitForStops().then(() => { ready = true; });
  finishes[1](); await second; await Promise.resolve(); expect(ready).toBe(false);
  finishes[0](); await first; await next; expect(ready).toBe(true);
});
