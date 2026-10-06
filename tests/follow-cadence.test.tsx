import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { cameraGuidanceReady, setupReadiness } from '../src/core/SetupReadiness';
import { FollowController, FOLLOW_CONTROL_INTERVAL_MS, STEERING_SMOOTHING } from '../src/core/FollowController';
import { ActionEngine } from '../src/core/ActionEngine';
import { makeAction, makeProject, makeRule, type Detection } from '../src/core/types';
import { PROJECT_TEMPLATES } from '../src/core/ProjectTemplates';
import { parseProject } from '../src/core/ProjectStorage';
import { RuleCard } from '../src/components/RuleCard';
import { MockRobotAdapter } from './MockRobotAdapter';
afterEach(() => vi.useRealTimers());
const box = { x: .4, y: .2, width: .2, height: .2 };
const action = { ...makeAction('move'), mode: 'follow' as const, followSpeed: 20 };

it('keeps a started camera ready through a brief frame gap, but not before startup or after disconnect', () => {
  expect(cameraGuidanceReady(true, -Infinity, 0)).toBe(false);
  for (const gap of [0, 250, 750, 1499]) {
    const ready = cameraGuidanceReady(true, 100, 100 + gap);
    expect(ready).toBe(true);
    const guidance = setupReadiness(makeProject(), { usableFrame: ready, modelReady: false,
      classes: [], connected: false, hardwareBusy: false, running: false, demo: false });
    expect(guidance.helper).not.toContain('Start your camera');
  }
  expect(cameraGuidanceReady(false, 100, 200)).toBe(false);
});
it('makes sustained missing frames unavailable and recovers on a new frame', () => {
  expect(cameraGuidanceReady(true, 100, 1600)).toBe(false);
  expect(cameraGuidanceReady(true, 1700, 1700)).toBe(true);
});
it('keeps compact guidance mounted with recovery text', () => {
  const app = readFileSync('src/App.tsx', 'utf8'), css = readFileSync('src/theme.css', 'utf8');
  expect(app).toContain('<p className="setup-guidance rules-guidance" id="play-blocker" aria-live="polite">Create rules to tell your robot what to do. {!ai && !readiness.play');
  expect(css).toMatch(/\.rules-section #play-blocker\s*\{[^}]*min-height:\s*0/);
  expect(app).toContain('cameraGuidanceReady(cameraOn, lastFrameAt, now)');
  expect(app).toContain('Camera frames are unavailable. Reconnect your camera.');
});
it('interpolates every control tick between perception results, with only one motor timer', async () => {
  vi.useFakeTimers(); const send = vi.fn().mockResolvedValue(undefined);
  const c = new FollowController(action, send, vi.fn(), vi.fn());
  await c.update([box]); await vi.advanceTimersByTimeAsync(300); await c.update([box]); await vi.advanceTimersByTimeAsync(100); await c.update([box]);
  send.mockClear();
  expect(vi.getTimerCount()).toBe(2); // One loss watchdog plus one motor interval.
  for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(20); await c.update([box]); }
  expect(vi.getTimerCount()).toBe(2); expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(240);
  expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < send.mock.calls.length; i++) {
    expect(send.mock.calls[i][0] - send.mock.calls[i - 1][0]).toBeLessThanOrEqual(STEERING_SMOOTHING.wheelMaxDelta);
  }
  await c.update([box]); await vi.advanceTimersByTimeAsync(400);
  const count = send.mock.calls.length; await vi.advanceTimersByTimeAsync(100);
  expect(send).toHaveBeenCalledTimes(count); // Settled commands are not resent.
  expect(FOLLOW_CONTROL_INTERVAL_MS).toBe(100);
  c.cancel(); expect(vi.getTimerCount()).toBe(0);
});
class Wheels extends MockRobotAdapter {
  setWheelSpeeds = vi.fn(async (left: number, right: number) => { this.state.left = left; this.state.right = right; });
}
async function start() {
  vi.useFakeTimers(); const robot = new Wheels(); await robot.connect();
  const engine = new ActionEngine(robot), r = { ...makeRule(), actions: [action] };
  const d: Detection = { className: 'person', confidence: .9, x: 256, y: 96, width: 128, height: 96, centerX: 320, centerY: 144 };
  await engine.updateRules([r], [r], { detections: [d], width: 640, height: 480, capturedAt: performance.now() });
  await vi.advanceTimersByTimeAsync(300);
  await engine.updateRules([], [r], { detections: [d], width: 640, height: 480, capturedAt: performance.now() });
  return { robot, engine };
}
it('emergency STOP sends zero immediately and cancels the motor tick', async () => {
  const { robot, engine } = await start(); await vi.advanceTimersByTimeAsync(200);
  expect(robot.state.left).toBeGreaterThan(4);
  await engine.stop(); expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
  const count = robot.setWheelSpeeds.mock.calls.length;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000); expect(robot.setWheelSpeeds).toHaveBeenCalledTimes(count);
});
it('stale target stops motors at the loss deadline and destroys interpolation', async () => {
  const { robot, engine } = await start(); await vi.advanceTimersByTimeAsync(749);
  expect(robot.state.left).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(1); expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
  expect(engine.activeMotorOwnerRuleId).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
it('brief explicit loss holds current speed rather than interpolating further upward', async () => {
  vi.useFakeTimers(); const send = vi.fn().mockResolvedValue(undefined), c = new FollowController(action, send, vi.fn(), vi.fn());
  await c.update([box]); await vi.advanceTimersByTimeAsync(300); await c.update([box]); await vi.advanceTimersByTimeAsync(100);
  send.mockClear(); await c.update([]);
  await vi.advanceTimersByTimeAsync(300); expect(send).not.toHaveBeenCalled();
  await c.update([box]); await vi.advanceTimersByTimeAsync(100);
  expect(send.mock.calls.at(-1)![0]).toBeGreaterThan(4); c.cancel();
});
it('Follow template keeps 20 percent through selection, parsing and the rule editor', () => {
  const project = parseProject(JSON.stringify(PROJECT_TEMPLATES.find(t => t.id === 'follow')!.createProject()));
  expect(project.rules[0].actions[0].followSpeed).toBe(20);
  const html = renderToStaticMarkup(<RuleCard rule={project.rules[0]} index={0} onChange={() => {}} onDelete={() => {}}
    capabilities={['move']} selectedClasses={['person']} />);
  const controls = (html.match(/<input[^>]+>/g) ?? []).filter(input => input.includes('aria-label="Follow speed %'));
  expect(controls).toHaveLength(2);
  for (const input of controls) expect(input).toContain('value="20"');
});
