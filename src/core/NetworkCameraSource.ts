export function networkCameraUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048)
    throw new Error('Enter an HTTP or HTTPS stream URL without credentials.');
  return url.href;
}

// CamS3 supplies Content-Length on each JPEG part. Bound both headers and frames.
export class MjpegFrames {
  private pending = new Uint8Array(0);
  push(chunk: Uint8Array): Uint8Array[] {
    if (this.pending.length + chunk.length > 2_100_000) throw new Error('Camera frame too large.');
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending); joined.set(chunk, this.pending.length);
    this.pending = joined;
    const frames: Uint8Array[] = [];
    while (this.pending.length) {
      let end = -1;
      for (let i = 0; i < this.pending.length - 3; i++) {
        if (this.pending[i] === 13 && this.pending[i + 1] === 10 && this.pending[i + 2] === 13 && this.pending[i + 3] === 10) { end = i; break; }
      }
      if (end < 0) {
        if (this.pending.length > 8192) throw new Error('Invalid camera headers.');
        break;
      }
      if (end > 8192) throw new Error('Invalid camera headers.');
      const header = new TextDecoder().decode(this.pending.subarray(0, end));
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
      if (!/content-type:\s*image\/jpeg/i.test(header) || !length || length > 2_000_000)
        throw new Error('Camera must provide JPEG parts with Content-Length.');
      if (this.pending.length < end + 4 + length) break;
      const frame = this.pending.slice(end + 4, end + 4 + length);
      if (frame[0] !== 255 || frame[1] !== 216 || frame[length - 2] !== 255 || frame[length - 1] !== 217)
        throw new Error('Invalid camera JPEG.');
      frames.push(frame);
      this.pending = this.pending.slice(end + 4 + length);
    }
    return frames;
  }
}

export class NetworkCameraSource {
  private controller = new AbortController();
  private ready = false;
  private timer?: ReturnType<typeof setTimeout>;
  private objectUrl?: string;
  private lastFrame = 0;
  private stopped = false;
  width = 0;
  height = 0;
  constructor(private image: HTMLImageElement) {}
  get frame() { return this.ready && Date.now() - this.lastFrame < 5000 ? this.image : null; }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    this.controller.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.image.removeAttribute('src');
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }
  async connect(value: string, ended: () => void): Promise<void> {
    const url = networkCameraUrl(value);
    const signal = this.controller.signal;
    const watchdog = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.controller.abort(), 5000);
    };
    watchdog();
    let first = true;
    return new Promise<void>((resolve, reject) => {
      void (async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const response = await fetch(url, { signal, mode: 'cors', cache: 'no-store', credentials: 'omit' });
          if (!response.ok || !response.headers.get('content-type')?.includes('multipart/x-mixed-replace') || !response.body)
            throw new Error('Camera did not return an MJPEG stream.');
          reader = response.body.getReader();
          const parser = new MjpegFrames();
          while (!signal.aborted) {
            const { value: chunk, done } = await reader.read();
            if (done) throw new Error('Camera stream ended.');
            const frames = parser.push(chunk);
            // Skip queued frames; retain only the latest decoded image.
            const bytes = frames.at(-1);
            if (!bytes) continue;
            const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
            const previous = this.objectUrl;
            this.objectUrl = next;
            this.ready = false;
            this.image.src = next;
            try { await this.image.decode(); }
            finally { if (previous) URL.revokeObjectURL(previous); }
            if (signal.aborted) break;
            if (!this.image.naturalWidth || !this.image.naturalHeight) throw new Error('Empty camera image.');
            this.lastFrame = Date.now();
            this.width = this.image.naturalWidth;
            this.height = this.image.naturalHeight;
            this.ready = true;
            watchdog();
            if (first) { first = false; resolve(); }
          }
        } catch (error) {
          if (!this.stopped) console.warn('Network camera connection ended:', error);
          if (first) reject(error);
        } finally {
          const wasStopped = this.stopped;
          this.stop();
          void reader?.cancel().catch(() => {});
          if (first) reject(new Error('Camera connection stopped.'));
          if (!wasStopped && !first) ended();
        }
      })();
    });
  }
}
