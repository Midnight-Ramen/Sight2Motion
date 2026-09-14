export interface WheelWatchdog {
  arm(slot: string, duration: number): Promise<void>;
  disarm(): void;
}
export class FinchWatchdog implements WheelWatchdog {
  private worker: Worker | null = null;
  private id = 0;
  private cancelArm: (() => void) | null = null;
  async arm(slot: string, duration: number) {
    this.disarm();
    const worker = (this.worker ??= new Worker(
      new URL('./FinchWatchdog.worker.ts', import.meta.url),
      { type: 'module' },
    ));
    const id = ++this.id;
    await new Promise<void>((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', error);
        this.cancelArm = null;
      };
      const error = () => {
        clean();
        reject(new Error('Wheel safety timer could not start. No movement was sent.'));
      };
      const message = (event: MessageEvent) => {
        if (event.data.id === id && event.data.type === 'armed') {
          clean();
          resolve();
        }
      };
      const timer = setTimeout(error, 1500);
      this.cancelArm = error;
      worker.addEventListener('message', message);
      worker.addEventListener('error', error, { once: true });
      worker.postMessage({ type: 'arm', id, slot, duration });
    });
  }
  disarm() {
    this.cancelArm?.();
    this.worker?.postMessage({ type: 'disarm' });
  }
}
