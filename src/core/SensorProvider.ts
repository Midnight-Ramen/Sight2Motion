import type { SensorDescriptor, SensorState, SensorValue } from './Sensors';
/** Round-robin reads: at most ten requests/second, never concurrent. */
export class SensorProvider {
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private state: SensorState = {};
  private changed: (state: SensorState) => void = () => {};
  constructor(private read: (sensor: SensorDescriptor, signal: AbortSignal) => Promise<SensorValue | null>) {}
  start(sensors: SensorDescriptor[], changed: (state: SensorState) => void) {
    this.stop();
    this.changed = changed;
    const version = this.version;
    let index = 0;
    const tick = async () => {
      if (version !== this.version || !sensors.length) return;
      const sensor = sensors[index++ % sensors.length];
      const controller = new AbortController();
      this.controller = controller;
      let reading: SensorValue | null = null;
      try { reading = await this.read(sensor, controller.signal); } catch { /* Unavailable is a normal input state. */ }
      if (version !== this.version) return;
      this.state = { ...this.state, [sensor.id]: { reading, updatedAt: performance.now() } };
      this.changed(this.state);
      this.timer = setTimeout(() => void tick(), 100);
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
