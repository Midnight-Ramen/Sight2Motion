import { describe, it, expect, vi } from 'vitest';
import { DetectionManager } from '../src/core/DetectionManager';
import { RuleEngine } from '../src/core/RuleEngine';
import { ActionEngine } from '../src/core/ActionEngine';
import { MockRobotAdapter } from './MockRobotAdapter';
import { makeRule, makeAction, makeProject, type Detection } from '../src/core/types';
import { parseProject } from '../src/core/ProjectStorage';
const person: Detection = {
  className: 'person',
  confidence: 0.9,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  centerX: 10,
  centerY: 10,
};
describe('DetectionManager', () => {
  it('tracks stable appearance and disappearance with confidence filtering', () => {
    const m = new DetectionManager();
    expect(m.update('r', [person], 'person', 0.7, 0).appeared).toBe(true);
    expect(m.update('r', [person], 'person', 0.7, 500).since).toBe(0);
    expect(m.update('r', [{ ...person, confidence: 0.6 }], 'person', 0.7, 600).disappeared).toBe(
      true,
    );
    expect(m.update('r', [], 'person', 0.7, 700).disappeared).toBe(false);
    expect(m.update('r', [person], 'person', 0.7, 900).since).toBe(900);
  });
  it('keeps rules with different thresholds independent', () => {
    const m = new DetectionManager();
    expect(m.update('a', [person], 'person', 0.7, 0).visible).toBe(true);
    expect(m.update('b', [person], 'person', 0.95, 0).visible).toBe(false);
  });
});
describe('RuleEngine', () => {
  it('requires a sustained 500 ms detection and fires only once per appearance', () => {
    const e = new RuleEngine(),
      r = makeRule();
    expect(e.evaluate([r], [person], 0)).toEqual([]);
    expect(e.evaluate([r], [person], 499)).toEqual([]);
    expect(e.evaluate([r], [person], 500)).toEqual([r]);
    expect(e.evaluate([r], [person], 5000)).toEqual([]);
    e.evaluate([r], [], 5100);
    expect(e.evaluate([r], [person], 5200)).toEqual([]);
    expect(e.evaluate([r], [person], 5700)).toEqual([r]);
  });
  it('enforces cooldown even after a new appearance', () => {
    const e = new RuleEngine(),
      r = { ...makeRule(), minDuration: 0 };
    expect(e.evaluate([r], [person], 0)).toEqual([r]);
    e.evaluate([r], [], 100);
    expect(e.evaluate([r], [person], 200)).toEqual([]);
    expect(e.evaluate([r], [person], 2000)).toEqual([r]);
  });
  it('does not qualify an interrupted short detection', () => {
    const e = new RuleEngine(),
      r = makeRule();
    e.evaluate([r], [person], 0);
    e.evaluate([r], [], 450);
    e.evaluate([r], [person], 500);
    expect(e.evaluate([r], [person], 900)).toEqual([]);
    expect(e.evaluate([r], [person], 1000)).toEqual([r]);
  });
  it('fires on disappearance only after the minimum visible duration', () => {
    const e = new RuleEngine(),
      r = { ...makeRule(), mode: 'disappearance' as const };
    e.evaluate([r], [person], 0);
    expect(e.evaluate([r], [], 400)).toEqual([]);
    e.evaluate([r], [person], 600);
    e.evaluate([r], [person], 1100);
    expect(e.evaluate([r], [], 1200)).toEqual([r]);
    expect(e.evaluate([r], [], 4000)).toEqual([]);
  });
  it('applies periodic interval and continuous cooldown', () => {
    for (const mode of ['interval', 'continuous'] as const) {
      const e = new RuleEngine(),
        r = { ...makeRule(), mode, minDuration: 0, interval: 3000 };
      expect(e.evaluate([r], [person], 0)).toEqual([r]);
      expect(e.evaluate([r], [person], 100)).toEqual([]);
      expect(e.evaluate([r], [person], mode === 'interval' ? 3000 : 2000)).toEqual([r]);
    }
  });
  it('ignores disabled rules and clears all appearance state when reset', () => {
    const e = new RuleEngine(),
      r = { ...makeRule(), minDuration: 0 };
    expect(e.evaluate([{ ...r, enabled: false }], [person], 0)).toEqual([]);
    expect(e.evaluate([r], [person], 100)).toEqual([r]);
    e.reset();
    expect(e.evaluate([r], [person], 101)).toEqual([r]);
  });
});
describe('ActionEngine', () => {
  it('runs enabled actions in order', async () => {
    const robot = new MockRobotAdapter();
    await robot.connect();
    const run = vi.spyOn(robot, 'executeAction');
    const e = new ActionEngine(robot);
    const a = makeAction(),
      b = { ...makeAction('tail'), enabled: false },
      c = makeAction('stop');
    expect(await e.run([a, b, c])).toBe(true);
    expect(run.mock.calls.map((call) => call[0].id)).toEqual([a.id, c.id]);
    expect(robot.state.beak).toBe(a.color);
  });
  it('STOP bypasses a running delay and cancels later movement', async () => {
    vi.useFakeTimers();
    try {
      const robot = new MockRobotAdapter();
      await robot.connect();
      const e = new ActionEngine(robot);
      const task = e.run([{ ...makeAction('wait'), duration: 5000 }, makeAction('move')]);
      await e.stop();
      expect(robot.state.left).toBe(0);
      await vi.runAllTimersAsync();
      expect(await task).toBe(false);
      expect(robot.state.left).toBe(0);
      expect(e.busy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops moving immediately and drops overlapping sequences', async () => {
    vi.useFakeTimers();
    try {
      const robot = new MockRobotAdapter();
      await robot.connect();
      const e = new ActionEngine(robot);
      const task = e.run([{ ...makeAction('move'), duration: 5000 }]);
      expect(robot.state.left).toBe(40);
      expect(await e.run([makeAction()])).toBe(false);
      await e.stop();
      expect(robot.state.left).toBe(0);
      await task;
    } finally {
      vi.useRealTimers();
    }
  });
  it('attempts stop and reports execution failure', async () => {
    const robot = new MockRobotAdapter();
    const stopped = vi.spyOn(robot, 'stop');
    const error = vi.fn();
    const e = new ActionEngine(robot, () => {}, error);
    expect(await e.run([makeAction()])).toBe(false);
    expect(stopped).toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(e.busy).toBe(false);
  });
});
describe('ProjectStorage validation', () => {
  it('round trips a project without storing images', () => {
    const p = makeProject();
    expect(parseProject(JSON.stringify(p))).toEqual(p);
    expect(JSON.stringify(p)).not.toContain('image');
  });
  it('rejects unsafe action values and unknown versions', () => {
    const p = makeProject();
    p.rules[0].actions[0].speed = 101;
    expect(() => parseProject(JSON.stringify(p))).toThrow();
    expect(() => parseProject('{"version":2}')).toThrow();
  });
  it('discards imported camera media and unknown fields', () => {
    const p = { ...makeProject(), cameraImage: 'data:image/png;base64,example' };
    expect(parseProject(JSON.stringify(p))).not.toHaveProperty('cameraImage');
  });
  it('rejects duplicate ids', () => {
    const p = makeProject();
    p.rules.push(p.rules[0]);
    expect(() => parseProject(JSON.stringify(p))).toThrow();
  });
});

it('updates only selected mock tail lights and persists the selection', async () => {
  const robot = new MockRobotAdapter();
  await robot.connect();
  const action = { ...makeAction('tail'), color: '#00ff00', tailLights: [1, 3] };
  await robot.executeAction(action, new AbortController().signal);
  expect(robot.state.tails).toEqual(['#00ff00', '#ccd7d0', '#00ff00', '#ccd7d0']);
  const project = makeProject();
  project.rules[0].actions = [action];
  expect(parseProject(JSON.stringify(project)).rules[0].actions[0].tailLights).toEqual([1, 3]);
});
