import type { Action, ActionKind } from './types';
import { delay, type RobotAdapter } from './RobotAdapter';
import { BirdBrainTransport } from './BirdBrainTransport';
import { FinchWatchdog, type WheelWatchdog } from './FinchWatchdog';
export interface FinchStatus {
  connector: 'not-detected' | 'detected';
  connection: 'disconnected' | 'connecting' | 'connected' | 'error';
  message: string;
}
export class FinchAdapter implements RobotAdapter {
  status: FinchStatus = {
    connector: 'not-detected',
    connection: 'disconnected',
    message: 'Connect Finch A in BlueBird, then attach here.',
  };
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private contacted = false;
  constructor(
    private changed: (status: FinchStatus) => void = () => {},
    private transport = new BirdBrainTransport(),
    readonly slot: 'A' | 'B' | 'C' = 'A',
    private watchdog: WheelWatchdog = new FinchWatchdog(),
  ) {}
  get connected() {
    return this.status.connection === 'connected';
  }
  private publish(patch: Partial<FinchStatus>) {
    this.status = { ...this.status, ...patch };
    this.changed({ ...this.status });
  }
  getCapabilities(): ActionKind[] {
    return ['beak', 'tail', 'move', 'wait', 'stop'];
  }
  async connect() {
    const token = ++this.generation;
    this.contacted = true;
    clearTimeout(this.heartbeat);
    this.publish({ connection: 'connecting', message: `Checking Finch ${this.slot}…` });
    try {
      const identity = await this.transport.request(`/hummingbird/in/isFinch/static/${this.slot}`);
      if (token !== this.generation) return;
      if (!['true', 'false', 'Not Connected'].includes(identity))
        throw new Error('The local service did not return a BlueBird identity response.');
      this.publish({ connector: 'detected' });
      if (identity !== 'true')
        throw new Error(
          identity === 'false'
            ? `Device ${this.slot} is not a Finch. Select your Finch in BlueBird.`
            : `Connect Finch ${this.slot} in BlueBird first.`,
        );
      await this.transport.command(`/hummingbird/out/stopall/${this.slot}`, undefined, true);
      if (token !== this.generation) return;
      this.publish({
        connection: 'connected',
        message: `Attached to Finch ${this.slot}. Physical responses still need observation.`,
      });
      this.monitor(token);
    } catch (error) {
      if (token !== this.generation) return;
      await this.stop().catch(() => {});
      this.publish({
        connection: 'error',
        message: error instanceof Error ? error.message : 'Could not attach to Finch.',
      });
      throw error;
    }
  }
  private monitor(token: number) {
    this.heartbeat = setTimeout(async () => {
      if (token !== this.generation || !this.connected) return;
      try {
        const reply = await this.transport.request(`/hummingbird/in/isFinch/static/${this.slot}`);
        if (token !== this.generation) return;
        if (reply !== 'true') throw new Error('Finch disconnected. Reconnect it in BlueBird.');
        this.monitor(token);
      } catch {
        if (token !== this.generation) return;
        this.publish({
          connection: 'error',
          message:
            'Communication lost. AI paused and STOP attempted. Check the physical robot and reconnect.',
        });
        await this.stop().catch(() => {});
      }
    }, 1000);
  }
  async stop() {
    this.transport.cancelPending();
    if (!this.contacted) return;
    try {
      await this.transport.command(`/hummingbird/out/stopall/${this.slot}`, undefined, true);
      this.watchdog.disarm();
    } catch (error) {
      this.publish({
        connection: 'error',
        message:
          'STOP could not be confirmed by BlueBird. Use the Finch power button if it is moving.',
      });
      throw error;
    }
  }
  async disconnect() {
    ++this.generation;
    clearTimeout(this.heartbeat);
    try {
      await this.stop();
    } finally {
      this.publish({
        connection: 'disconnected',
        message: 'Detached from this app. Bluetooth pairing stays in BlueBird.',
      });
    }
  }
  private requireConnected() {
    if (!this.connected) throw new Error(`Attach to Finch ${this.slot} first.`);
  }
  async setBeak(red: number, green: number, blue: number, signal?: AbortSignal) {
    this.requireConnected();
    const rgb = [red, green, blue];
    if (rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
      throw new Error('RGB values must be bytes.');
    await this.transport.command(`/hummingbird/out/triled/1/${rgb.join('/')}/${this.slot}`, signal);
  }
  async setWheelSpeeds(left: number, right: number, duration: number, signal: AbortSignal) {
    this.requireConnected();
    // Validation milestone: bounded low-speed motion only, irrespective of imported settings.
    if (
      ![left, right].every((v) => Number.isFinite(v) && Math.abs(v) <= 20) ||
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 1000
    )
      throw new Error('For hardware validation use at most 20% speed and 1000 ms.');
    if (signal.aborted) return;
    await this.watchdog.arm(this.slot, duration);
    if (signal.aborted) {
      await this.stop();
      return;
    }
    try {
      await this.transport.command(
        `/hummingbird/out/wheels/${this.slot}/${Math.round(left)}/${Math.round(right)}/`,
        signal,
      );
      await delay(duration, signal);
    } finally {
      await this.transport.command(`/hummingbird/out/stopFinch/${this.slot}`, undefined, true);
      this.watchdog.disarm();
    }
  }
  async executeAction(action: Action, signal: AbortSignal) {
    this.requireConnected();
    if (signal.aborted) return;
    switch (action.kind) {
      case 'beak': {
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) throw new Error('Choose a valid beak color.');
        await this.setBeak(
          ...([1, 3, 5].map((i) => parseInt(action.color.slice(i, i + 2), 16)) as [
            number,
            number,
            number,
          ]),
          signal,
        );
        break;
      }
      case 'tail': {
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) throw new Error('Choose a valid tail color.');
        const rgb = [1, 3, 5].map((i) => parseInt(action.color.slice(i, i + 2), 16));
        const lights = action.tailLights ?? [1, 2, 3, 4];
        if (lights.some(light => ![1, 2, 3, 4].includes(light))) throw new Error('Choose tail lights 1–4.');
        for (const light of new Set(lights)) {
          if (signal.aborted) break;
          await this.transport.command(`/hummingbird/out/triled/${light + 1}/${rgb.join('/')}/${this.slot}`, signal);
        }        break;
      }
      case 'move': {
        const s = action.speed;
        await this.setWheelSpeeds(
          action.direction === 'backward' || action.direction === 'left' ? -s : s,
          action.direction === 'backward' || action.direction === 'right' ? -s : s,
          action.duration,
          signal,
        );
        break;
      }
      case 'wait':
        await delay(action.duration, signal);
        break;
      case 'stop':
        await this.stop();
        break;
      default:
        throw new Error('This action is not enabled for real Finch validation.');
    }
  }
}

