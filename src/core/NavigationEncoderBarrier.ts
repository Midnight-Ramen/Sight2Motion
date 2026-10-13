import { encoderPair } from './EncoderRecording';
import type { SensorState } from './Sensors';
/** Waits on publications from the existing provider, never polls hardware. */
export class NavigationEncoderBarrier {
  private pending?: { after: number; resolve: () => void; reject: (error: Error) => void };
  constructor(private sensors: () => SensorState, private now = () => performance.now(), private timeoutMs = 2500) {}
  sensorsUpdated() {
    const waiting = this.pending, state = this.sensors();
    if (waiting && encoderPair(state, this.now()) &&
      state.finchEncoderLeft.updatedAt > waiting.after && state.finchEncoderRight.updatedAt > waiting.after) waiting.resolve();
  }
  wait(after: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending = undefined; };
      const fail = (error: Error) => { clean(); reject(error); };
      const abort = () => fail(new Error('encoder wait cancelled'));
      const timer = setTimeout(() => fail(new Error('stale encoders: no new pair after STOP')), this.timeoutMs);
      this.pending = { after, resolve: () => { clean(); resolve(); }, reject: fail };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else this.sensorsUpdated();
    });
  }
}
