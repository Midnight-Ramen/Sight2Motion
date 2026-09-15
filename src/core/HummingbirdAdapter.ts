import { BirdBrainTransport } from './BirdBrainTransport';
import { delay, type RobotAdapter, type RobotStatus } from './RobotAdapter';
import { ROBOTS, portsFor } from './RobotCapabilities';
import type { Action } from './types';
import { normalizeSensor, type SensorDescriptor } from './Sensors';
import { SensorProvider } from './SensorProvider';

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) throw new Error('Choose a valid output value.');
  return Math.max(min, Math.min(max, value));
};
// BirdBrain-Python-Library: calculate_servo_p and calculate_servo_r.
export const positionByte = (angle: number) => Math.trunc(clamp(angle, 0, 180) * 254 / 180);
export const rotationByte = (speed: number) => {
  const value = clamp(speed, -100, 100);
  return Math.abs(value) < 10 ? 255 : Math.trunc(value * 23 / 100 + 122);
};

export class HummingbirdAdapter implements RobotAdapter {
  readonly sensors = new SensorProvider((sensor, signal) => this.readSensor(sensor, signal));
  async readSensor(sensor: SensorDescriptor, signal: AbortSignal) {
    if (!this.connected || ![1, 2, 3].includes(sensor.port) || sensor.type === 'digital') return null;
    return normalizeSensor(sensor.type, await this.transport.request(`/hummingbird/in/sensor/${sensor.port}/${this.slot}`, signal));
  }
  status: RobotStatus = { connector: 'not-detected', connection: 'disconnected', message: 'Connect Hummingbird Bit A in BlueBird, then attach here.' };
  private generation = 0;
  private identified = false;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private rotationPorts = new Set<number>();
  constructor(private changed: (status: RobotStatus) => void = () => {},
    private transport = new BirdBrainTransport(), readonly slot: 'A' | 'B' | 'C' = 'A') {}
  get connected() { return this.status.connection === 'connected'; }
  getCapabilities() { return [...ROBOTS.hummingbird.actions]; }
  private publish(patch: Partial<RobotStatus>) { this.status = { ...this.status, ...patch }; if (!this.connected) this.sensors.stop(); this.changed({ ...this.status }); }
  private async command(path: string, signal?: AbortSignal, emergency = false) {
    try { await this.transport.command(path, signal, emergency); }
    catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : 'Command failed.'}`);
    }
  }
  async connect() {
    const token = ++this.generation;
    clearTimeout(this.heartbeat);
    this.publish({ connection: 'connecting', message: `Checking Hummingbird Bit ${this.slot}…` });
    try {
      const identity = await this.transport.request(`/hummingbird/in/isHummingbird/static/${this.slot}`);
      if (token !== this.generation) return;
      if (!['true', 'false', 'Not Connected'].includes(identity)) throw new Error('BlueBird did not return a recognized robot identity.');
      this.publish({ connector: 'detected' });
      if (identity !== 'true') throw new Error(`Connect Hummingbird Bit as device ${this.slot} in BlueBird first.`);
      this.identified = true;
      // Match the existing connection initialization: disable prior outputs, never command angle zero.
      await this.command(`/hummingbird/out/stopall/${this.slot}`, undefined, true);
      if (token !== this.generation) return;
      this.publish({ connection: 'connected', message: `Attached to Hummingbird Bit ${this.slot}. Test the connected outputs before running rules.` });
      this.monitor(token);
    } catch (error) {
      if (token !== this.generation) return;
      await this.stop().catch(() => {});
      this.publish({ connection: 'error', message: error instanceof Error ? error.message : 'Could not attach to Hummingbird Bit.' });
      throw error;
    }
  }
  private monitor(token: number) {
    this.heartbeat = setTimeout(async () => {
      if (token !== this.generation || !this.connected) return;
      try {
        const identity = await this.transport.request(`/hummingbird/in/isHummingbird/static/${this.slot}`);
        if (token !== this.generation) return;
        if (identity !== 'true') throw new Error('Hummingbird Bit disconnected.');
        this.monitor(token);
      } catch {
        if (token !== this.generation) return;
        this.publish({ connection: 'error', message: 'Communication lost. AI paused and STOP attempted. Reconnect Hummingbird Bit.' });
        await this.stop().catch(() => {});
      }
    }, 1000);
  }
  async stopOutput(key: string) {
    if (!/^servo:[1-4]$/.test(key)) throw new Error('Unsupported Hummingbird output.');
    const port = Number(key.split(':')[1]);
    // A newer position action on this port must not receive a rotation stop command.
    if (!this.rotationPorts.has(port)) return;
    await this.command(`/hummingbird/out/rotation/${port}/255/${this.slot}`, undefined, true);
    this.rotationPorts.delete(port);
  }
  async stop() {
    this.transport.cancelPending();
    if (!this.identified) return;
    const results = await Promise.allSettled([...this.rotationPorts].map(port => this.stopOutput(`servo:${port}`)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      this.publish({ connection: 'error', message: `STOP could not be confirmed. ${String(failed.reason)}` });
      throw failed.reason;
    }
  }
  async disconnect() {
    this.sensors.stop();
    ++this.generation;
    clearTimeout(this.heartbeat);
    try { await this.stop(); }
    finally { this.publish({ connection: 'disconnected', message: 'Detached from this app. Pairing stays in BlueBird.' }); }
  }
  async executeAction(action: Action, signal: AbortSignal) {
    if (!this.connected) throw new Error(`Attach Hummingbird Bit ${this.slot} first.`);
    if (signal.aborted) return;
    if (!this.getCapabilities().includes(action.kind)) throw new Error('Action not available for Hummingbird Bit.');
    const port = action.port ?? 1;
    const ports = portsFor(action.kind);
    if (ports.length && !ports.includes(port)) throw new Error('Choose a valid Hummingbird output port.');
    switch (action.kind) {
      case 'singleLed':
        await this.command(`/hummingbird/out/led/${port}/${Math.trunc(clamp(action.brightness ?? 100, 0, 100) * 255 / 100)}/${this.slot}`, signal);
        break;
      case 'triLed': {
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) throw new Error('Choose a valid LED color.');
        const rgb = [1, 3, 5].map(i => parseInt(action.color.slice(i, i + 2), 16));
        await this.command(`/hummingbird/out/triled/${port}/${rgb.join('/')}/${this.slot}`, signal);
        break;
      }
      case 'positionServo':
        await this.command(`/hummingbird/out/servo/${port}/${positionByte(action.angle ?? 90)}/${this.slot}`, signal);
        this.rotationPorts.delete(port);
        break;
      case 'rotationServo': {
        if (!['forward', 'backward'].includes(action.direction)) throw new Error('Choose Forward or Reverse.');
        const speed = clamp(action.speed, 0, 100) * (action.direction === 'backward' ? -1 : 1);
        this.rotationPorts.add(port);
        try {
          await this.command(`/hummingbird/out/rotation/${port}/${rotationByte(speed)}/${this.slot}`, signal);
          if (action.mode === 'continuous') return;
          await delay(clamp(action.duration, 0, 10000), signal);
        } catch (error) {
          await this.stopOutput(`servo:${port}`).catch(() => {});
          throw error;
        } finally {
          if (action.mode !== 'continuous') await this.stopOutput(`servo:${port}`);
        }
        break;
      }
      case 'stop': await this.stop(); break;
      case 'wait': await delay(action.duration, signal); break;
    }
  }
}
