import { describe, it, expect, vi } from 'vitest';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { FinchAdapter } from '../src/core/FinchAdapter';
import { ActionEngine } from '../src/core/ActionEngine';
import { RuleEngine } from '../src/core/RuleEngine';
import { makeAction, makeRule } from '../src/core/types';
import { RobotRouter } from '../src/core/RobotRouter';
import { MockRobotAdapter } from '../src/core/RobotAdapter';
function setup(identity = 'true') {
  const fetcher = vi.fn<typeof fetch>(
    async (url) => new Response(String(url).includes('/in/') ? identity : '200'),
  );
  const watchdog = { arm: vi.fn(async () => {}), disarm: vi.fn() };
  const transport = new BirdBrainTransport(fetcher);
  const adapter = new FinchAdapter(() => {}, transport, 'A', watchdog);
  return {
    fetcher,
    watchdog,
    transport,
    adapter,
    paths: () => fetcher.mock.calls.map((c) => String(c[0])),
  };
}
describe('real Finch adapter using mocked HTTP only', () => {
  it('calls browser fetch without binding it to the transport instance', async () => {
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this instanceof BirdBrainTransport) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response('true'));
    });
    try {
      await expect(new BirdBrainTransport().request('/hummingbird/in/isFinch/static/A')).resolves.toBe('true');
    } finally { vi.unstubAllGlobals(); }
  });
  it('attaches only to an identified Finch and uses desktop beak byte ordering', async () => {
    const s = setup();
    await s.adapter.connect();
    await s.adapter.setBeak(0, 255, 0);
    expect(s.paths()).toContain('http://127.0.0.1:30061/hummingbird/out/triled/1/0/255/0/A');
    expect(s.adapter.connected).toBe(true);
    await s.adapter.disconnect();
  });
  it('rejects the wrong robot and disconnected slot even when HTTP status is 200', async () => {
    for (const id of ['false', 'Not Connected', '<html>other service</html>']) {
      const s = setup(id);
      await expect(s.adapter.connect()).rejects.toThrow();
      expect(s.adapter.connected).toBe(false);
      expect(s.paths().some((p) => p.includes('/wheels/'))).toBe(false);
    }
  });
  it('checks command response body, not just status', async () => {
    const transport = new BirdBrainTransport(
      vi.fn(async () => new Response('404')) as typeof fetch,
    );
    await expect(transport.command('/hummingbird/out/stopall/A')).rejects.toThrow('unexpected');
  });
  it('does not send wheels until the independent watchdog is armed', async () => {
    const s = setup();
    await s.adapter.connect();
    s.watchdog.arm.mockRejectedValueOnce(new Error('worker unavailable'));
    await expect(
      s.adapter.setWheelSpeeds(10, 10, 1000, new AbortController().signal),
    ).rejects.toThrow();
    expect(s.paths().some((p) => p.includes('/wheels/'))).toBe(false);
    await s.adapter.disconnect();
  });
  it('rejects unbounded or fast wheel settings', async () => {
    const s = setup();
    await s.adapter.connect();
    await expect(
      s.adapter.setWheelSpeeds(21, 10, 1000, new AbortController().signal),
    ).rejects.toThrow();
    await expect(
      s.adapter.setWheelSpeeds(10, 10, 1001, new AbortController().signal),
    ).rejects.toThrow();
    expect(s.paths().some((p) => p.includes('/wheels/'))).toBe(false);
    await s.adapter.disconnect();
  });
  it('stops a diagnostic drive at its deadline', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.adapter.connect();
      const task = s.adapter.setWheelSpeeds(10, 10, 1000, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(1001);
      await task;
      expect(s.watchdog.arm).toHaveBeenCalledWith('A', 1000);
      expect(s.paths()).toContain('http://127.0.0.1:30061/hummingbird/out/wheels/A/10/10/');
      expect(s.paths().at(-1)).toContain('/stopFinch/A');
      await s.adapter.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
  it('emergency STOP cancels a sequence before its later action', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.adapter.connect();
      const engine = new ActionEngine(s.adapter);
      const task = engine.run([
        { ...makeAction('move'), speed: 10, duration: 1000 },
        { ...makeAction('beak'), color: '#ff0000' },
      ]);
      await vi.advanceTimersByTimeAsync(100);
      await engine.stop();
      await task;
      expect(s.paths().some((p) => p.includes('/triled/'))).toBe(false);
      expect(s.paths().some((p) => p.includes('/stopall/A'))).toBe(true);
      await s.adapter.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
  it('marks a lost connection as error and attempts stop', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.adapter.connect();
      s.fetcher.mockResolvedValueOnce(new Response('Not Connected'));
      await vi.advanceTimersByTimeAsync(1100);
      expect(s.adapter.status.connection).toBe('error');
      expect(s.paths().at(-1)).toContain('/stopall/A');
      await s.adapter.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
  it('runs the normal detection/rule/action chain with either adapter', async () => {
    const s = setup();
    await s.adapter.connect();
    const mock = new MockRobotAdapter();
    const router = new RobotRouter(mock);
    await router.connect();
    const engine = new ActionEngine(router);
    const rule = { ...makeRule(), actions: [{ ...makeAction(), color: '#00ff00' }] };
    const detector = new RuleEngine();
    const detections = [
      {
        className: 'person',
        confidence: 0.9,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        centerX: 5,
        centerY: 5,
      },
    ];
    detector.evaluate([rule], detections, 0);
    const fired = detector.evaluate([rule], detections, 500);
    await engine.run(fired[0].actions);
    expect(mock.state.beak).toBe('#00ff00');
    await router.select(s.adapter);
    await engine.run(fired[0].actions);
    expect(s.paths().at(-1)).toContain('/triled/1/0/255/0/A');
    await router.disconnect();
  });
  it('failed STOP does not create an unhandled rejection in ActionEngine', async () => {
    const s = setup();
    await s.adapter.connect();
    s.fetcher.mockRejectedValue(new Error('offline'));
    const log = vi.fn();
    const engine = new ActionEngine(s.adapter, log);
    await expect(engine.stop()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('STOP delivery failed'));
    await s.adapter.disconnect().catch(() => {});
  });
});




it('addresses selected Finch tail LEDs individually', async () => {
  const s = setup();
  await s.adapter.connect();
  await s.adapter.executeAction({ ...makeAction('tail'), color: '#00ff00', tailLights: [1, 3] }, new AbortController().signal);
  expect(s.paths()).toContain('http://127.0.0.1:30061/hummingbird/out/triled/2/0/255/0/A');
  expect(s.paths()).toContain('http://127.0.0.1:30061/hummingbird/out/triled/4/0/255/0/A');
  expect(s.paths().filter(p => p.includes('/triled/'))).toHaveLength(2);
  await s.adapter.disconnect();
});
