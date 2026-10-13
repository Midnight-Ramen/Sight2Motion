import { expect, it, vi } from 'vitest';
import { FinchAdapter } from '../src/core/FinchAdapter';
import { BirdBrainTransport } from '../src/core/BirdBrainTransport';
import { SensorProvider } from '../src/core/SensorProvider';

it('counts successful responses, including unchanged values, but not failed requests', async () => {
  let raw = '23';
  let fail = false;
  const adapter = new FinchAdapter(() => {}, new BirdBrainTransport(vi.fn(async () => {
    if (fail) throw new Error('offline');
    return new Response(raw);
  }) as typeof fetch));
  adapter.status.connection = 'connected';
  const sensor = { id: 'finchDistance', label: 'Distance', type: 'finchDistance' as const };
  const signal = new AbortController().signal;
  await adapter.readSensor(sensor, signal);
  await adapter.readSensor(sensor, signal);
  expect(adapter.feedback.finchDistance.sequence).toBe(2);
  raw = '8';
  await adapter.readSensor(sensor, signal);
  expect(adapter.feedback.finchDistance.value).toBe(8);
  fail = true;
  await expect(adapter.readSensor(sensor, signal)).rejects.toThrow();
  expect(adapter.feedback.finchDistance.sequence).toBe(3);
});

it('publishes changing sensor readings without any Play or motion state', async () => {
  vi.useFakeTimers();
  let value = 23;
  const changed = vi.fn();
  const provider = new SensorProvider(async () => ({ kind: 'number', value }));
  try {
    provider.start([{ id: 'finchDistance', label: 'Distance', type: 'finchDistance' }], changed);
    await vi.advanceTimersByTimeAsync(1);
    value = 8;
    await vi.advanceTimersByTimeAsync(100);
    expect(changed.mock.lastCall?.[0].finchDistance.reading.value).toBe(8);
    expect(provider.diagnostics.starts).toBe(1);
    expect(provider.diagnostics.publications).toBe(2);
  } finally { provider.stop(); vi.useRealTimers(); }
});
