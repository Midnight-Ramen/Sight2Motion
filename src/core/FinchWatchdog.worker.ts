// This dedicated worker keeps the wheel deadline independent of main-thread YOLO inference.
// Delivery is still best-effort if the Connector or Bluetooth connection disappears.
let timers: ReturnType<typeof setTimeout>[] = [];
let generation = 0;
function clear() {
  generation++;
  timers.forEach(clearTimeout);
  timers = [];
}
self.onmessage = (
  event: MessageEvent<{ type: 'arm' | 'disarm'; slot: string; duration: number; id: number }>,
) => {
  clear();
  const { type, slot, duration, id } = event.data;
  if (type !== 'arm') return;
  if (!/^[ABC]$/.test(slot) || !Number.isFinite(duration) || duration < 1 || duration > 1000)
    return;
  const token = generation;
  const stop = () => {
    if (token !== generation) return;
    void fetch(`http://127.0.0.1:30061/hummingbird/out/stopFinch/${slot}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    }).catch(() => {});
  };
  // Repeat the deadline stop to cover transient failures or a late command response.
  timers = [0, 250, 750].map((offset) => setTimeout(stop, duration + offset));
  self.postMessage({ id, type: 'armed' });
};
export {};

