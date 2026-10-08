import type { SensorDescriptor, SensorState, SensorValue } from './Sensors';
export const SENSOR_POLL_INTERVAL = 100;
/** Normal round-robin is 100 ms. Optional priority pairs share this one serial loop. */
export class SensorProvider {
  private priorityIds: string[] = [];
  private priorityIndex = 0;
  setPriority(ids: string[]) {
    if(ids.join(',')===this.priorityIds.join(','))return;
    this.priorityIds=[...ids];this.priorityIndex=0;
  }
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
      const priority=this.priorityIds.map(id=>sensors.find(s=>s.id===id)).filter((s):s is SensorDescriptor=>!!s);
      const background=sensors.filter(s=>!this.priorityIds.includes(s.id));
      const phase=this.priorityIndex++%(priority.length+1);
      const sensor=priority.length ? (phase<priority.length ? priority[phase] : background.length ? background[index++%background.length] : priority[0]) : sensors[index++%sensors.length];
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
      this.timer = setTimeout(() => void tick(), priority.length ? (phase<priority.length-1 ? 0 : 50) : SENSOR_POLL_INTERVAL);
    };
    void tick();
  }
  stop() {
    this.setPriority([]);
    ++this.version;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.state = {};
    this.changed({});
    this.changed = () => {};
  }
}
