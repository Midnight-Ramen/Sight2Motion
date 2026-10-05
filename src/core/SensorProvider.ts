import type { SensorDescriptor, SensorState, SensorValue } from './Sensors';
export const SENSOR_POLL_INTERVAL = 100;
/** Round-robin reads: at most ten requests/second, never concurrent. */
export class SensorProvider {
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private state: SensorState = {};
  private inFlight?: Promise<SensorValue | null>;
  private changed: (state: SensorState) => void = () => {};
  constructor(private read: (sensor: SensorDescriptor, signal: AbortSignal) => Promise<SensorValue | null>) {}
  start(sensors: SensorDescriptor[], changed: (state: SensorState) => void) {
    this.stop();
    this.changed = changed;
    const version = this.version;
    let index = 0;
    const tick = async () => {
      // A restart aborts the previous read, but must also let it settle before another request.
      if (this.inFlight) await this.inFlight.catch(() => null);
      if (version !== this.version || !sensors.length) return;
      const sensor = sensors[index++ % sensors.length];
      const controller = new AbortController();
      this.controller = controller;
      let reading: SensorValue | null = null;
      const pending = this.read(sensor, controller.signal);
      this.inFlight = pending;
      try { reading = await pending; } catch { /* Unavailable is a normal input state. */ }
      finally { if (this.inFlight === pending) this.inFlight = undefined; }
      if (version !== this.version) return;
      this.state = { ...this.state, [sensor.id]: { reading, updatedAt: performance.now() } };
      this.changed(this.state);
      this.timer = setTimeout(() => void tick(), SENSOR_POLL_INTERVAL);
    };
    void tick();
  }
  stop() {
    ++this.version;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.state = {};
    this.changed({});
    this.changed = () => {};
  }
}
