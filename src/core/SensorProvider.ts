import type { SensorDescriptor, SensorState, SensorValue } from './Sensors';
export const SENSOR_POLL_INTERVAL = 100;
export const PRIORITY_PAIR_INTERVAL = 20;
/** Normal round-robin is 100 ms. Optional priority pairs share this one serial loop. */
export class SensorProvider {
  private priorityIds: string[] = [];
  private priorityIndex = 0;
  private pairHandler?: (state:SensorState)=>Promise<void>;
  constructor(private read: (sensor: SensorDescriptor, signal: AbortSignal) => Promise<SensorValue | null>, private priorityChanged: (active:boolean)=>void = ()=>{}) {}
  setPriority(ids: string[], handler?: (state:SensorState)=>Promise<void>) {
    this.pairHandler=handler;
    if(ids.join(',')===this.priorityIds.join(','))return;
    this.priorityIds=[...ids];this.priorityIndex=0;this.priorityChanged(ids.length>0);
  }
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private state: SensorState = {};
  private inFlight?: Promise<SensorValue | null>;
  private changed: (state: SensorState) => void = () => {};
  start(sensors: SensorDescriptor[], changed: (state: SensorState) => void) {
    this.stop();
    this.changed = changed;
    const version = this.version;
    let index = 0, pairStarted=0;
    const tick = async () => {
      // A restart aborts the previous read, but must also let it settle before another request.
      if (this.inFlight) await this.inFlight.catch(() => null);
      if (version !== this.version || !sensors.length) return;
      const priority=this.priorityIds.map(id=>sensors.find(s=>s.id===id)).filter((s):s is SensorDescriptor=>!!s);

      const phase=this.priorityIndex++%Math.max(1,priority.length);
      if(priority.length&&phase===0)pairStarted=performance.now();
      const sensor=priority.length ? priority[phase] : sensors[index++%sensors.length];
      const controller = new AbortController();
      this.controller = controller;
      let reading: SensorValue | null = null;
      const pending = this.read(sensor, controller.signal);
      this.inFlight = pending;
      try { reading = await pending; } catch { /* Unavailable is a normal input state. */ }
      finally { if (this.inFlight === pending) this.inFlight = undefined; }
      if (version !== this.version) return;
      this.state = { ...this.state, [sensor.id]: { reading, updatedAt: performance.now() } };
      // Publish the pair together; never steer using a half-updated priority pair.
      if(!priority.length||phase===priority.length-1){
        if(priority.length&&this.priorityIds.join()===priority.map(s=>s.id).join())await this.pairHandler?.(this.state);
        if(version!==this.version)return;
        this.changed(this.state);
      }
      this.timer = setTimeout(() => void tick(), priority.length ? (phase<priority.length-1 ? 0 : Math.max(0,PRIORITY_PAIR_INTERVAL-(performance.now()-pairStarted))) : SENSOR_POLL_INTERVAL);
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
