export function networkCameraUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048)
    throw new Error('Enter an HTTP or HTTPS stream URL without credentials.');
  return url.href;
}

export interface NetworkCameraDiagnostics {
  url: string;
  status: 'Connecting' | 'Connected' | 'Error' | 'Disconnected';
  stream?: 'Connecting' | 'Healthy' | 'Stalled' | 'Reconnecting' | 'Disconnected' | 'Stopped';
  browserWarning?: string;
  phase: 'request' | 'response' | 'read' | 'parse' | 'decode';
  attempt: number;
  reconnectAttempts: number;
  reconnectResult?: 'pending' | 'success' | 'failure' | 'cancelled';
  connectedAt?: number;
  lastFrameAt?: number;
  lastBytesAt?: number;
  frames: number;
  lastError?: { at: number; reason: string; category: string; phase: string };
}
export function createNetworkCameraDiagnostics(): NetworkCameraDiagnostics {
  return { url: '', status: 'Disconnected', phase: 'request', attempt: 0, reconnectAttempts: 0, frames: 0 };
}
/** Fetch hides DNS/CORS/socket details in many browsers; never infer a precise cause from "Failed to fetch". */
export function networkCameraFailureCategory(error: unknown, phase: NetworkCameraDiagnostics['phase'], timedOut: boolean) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'hostname/mDNS failure';
  if (/ERR_NETWORK_UNREACHABLE|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED/i.test(message)) return 'network unreachable';
  if (timedOut) return phase === 'request' ? 'connection timeout (network/DNS/browser cause unresolved)' :
    phase === 'decode' ? 'image decode stalled' : 'MJPEG stream stalled';
  if (phase === 'parse') return 'MJPEG parser failure';
  if (phase === 'decode') return 'image decode/client failure';
  if (phase === 'response') return 'invalid HTTP/MJPEG response';
  if (phase === 'read' && /Camera stream ended/.test(message)) return 'MJPEG stream ended';
  return 'transport/browser failure (network/DNS/CORS cause unresolved)';
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

export const NETWORK_FRAME_TIMEOUT_MS = 2000;
export const NETWORK_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const NETWORK_FETCH_FAILURE_LIMIT = 3;
export const NETWORK_IMMEDIATE_FAILURE_MS = 1000;
export const NETWORK_BROWSER_GUIDANCE = 'This browser could not reach the local network camera. Try allowing Local Network Access or use Chrome.';

/** Opt in only when Request exposes support; never patch global fetch or infer browser brand. */
export function networkCameraRequestOptions(signal: AbortSignal): RequestInit & { targetAddressSpace?: 'local' } {
  return { signal, mode: 'cors', cache: 'no-store', credentials: 'omit',
    ...(typeof Request !== 'undefined' && 'targetAddressSpace' in Request.prototype ? { targetAddressSpace: 'local' as const } : {}) };
}

/** Abort decoding as well as transport: image.decode() itself does not accept a signal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('Camera connection stopped.'));
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export class NetworkCameraSource {
  private controller?: AbortController;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private ready = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private objectUrl?: string;
  private stopped = false;
  private started = false;
  private immediateFailures = 0;
  private lastFrameLog = -Infinity;
  private rejectConnection?: (reason: Error) => void;
  lastNetworkFrameAt: number | undefined;
  frameVersion = 0;
  width = 0;
  height = 0;
  constructor(private image: HTMLImageElement, private diagnostic = createNetworkCameraDiagnostics()) {}
  get diagnostics(): NetworkCameraDiagnostics {
    return { ...this.diagnostic, lastError: this.diagnostic.lastError ? { ...this.diagnostic.lastError } : undefined };
  }
  get healthy() {
    return !this.stopped && this.diagnostic.stream === 'Healthy' && this.lastNetworkFrameAt !== undefined &&
      Date.now() - this.lastNetworkFrameAt < NETWORK_FRAME_TIMEOUT_MS;
  }
  get frame() { return this.ready && this.healthy ? this.image : null; }
  private log(event: string, error?: unknown) {
    const details = { ...this.diagnostics, timestamp: new Date().toISOString(),
      hostname: this.diagnostic.url ? new URL(this.diagnostic.url).hostname : '',
      lastFrameTimestamp: this.diagnostic.lastFrameAt === undefined ? null : new Date(this.diagnostic.lastFrameAt).toISOString(),
      lastBytesTimestamp: this.diagnostic.lastBytesAt === undefined ? null : new Date(this.diagnostic.lastBytesAt).toISOString(),
      browserOnline: typeof navigator === 'undefined' ? undefined : navigator.onLine };
    if (error !== undefined) console.warn(`[Network Camera] ${event}`, details, error);
    else console.info(`[Network Camera] ${event}`, details);
  }
  private closeTransport() {
    clearTimeout(this.watchdog); this.watchdog = undefined;
    this.ready = false;
    this.controller?.abort(new Error('Camera connection stopped.'));
    this.controller = undefined;
    void this.reader?.cancel().catch(() => {}); this.reader = undefined;
    this.image.removeAttribute('src');
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }
  stop(reason: 'manual' | 'replacement' = 'manual') {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.closeTransport();
    this.diagnostic.status = 'Disconnected'; this.diagnostic.stream = 'Disconnected';
    if (this.diagnostic.reconnectResult === 'pending') this.diagnostic.reconnectResult = 'cancelled';
    this.log(reason === 'manual' ? 'manual disconnect' : 'connection replaced');
    this.rejectConnection?.(new Error('Camera connection stopped.')); this.rejectConnection = undefined;
  }
  async connect(value: string, ended: () => void, recovered: () => void = () => {}): Promise<void> {
    const url = networkCameraUrl(value);
    if (this.started || this.stopped) throw new Error('Camera source already used.');
    this.started = true;
    this.diagnostic.url = url;
    this.diagnostic.reconnectAttempts = 0;
    this.diagnostic.reconnectResult = undefined;
    this.diagnostic.browserWarning = undefined;
    return new Promise<void>((resolve, reject) => {
      this.rejectConnection = reject;
      const attempt = async (retry: boolean) => {
        if (this.stopped) return;
        const controller = new AbortController(), signal = controller.signal;
        const requestedAt = performance.now();
        this.controller = controller;
        this.diagnostic.attempt++;
        this.diagnostic.status = 'Connecting';
        this.diagnostic.stream = retry ? 'Reconnecting' : 'Connecting';
        this.diagnostic.phase = 'request';
        if (retry) {
          this.diagnostic.reconnectAttempts++;
          this.diagnostic.reconnectResult = 'pending';
          this.log(`reconnect attempt ${this.diagnostic.reconnectAttempts}`);
        } else this.log('connection attempt');
        let opened = false, timedOut = false;
        const watchdog = () => {
          clearTimeout(this.watchdog);
          this.watchdog = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`No usable camera frame within ${NETWORK_FRAME_TIMEOUT_MS} ms.`));
          }, NETWORK_FRAME_TIMEOUT_MS);
        };
        watchdog();
        try {
          const requestUrl = new URL(url);
          if (retry) requestUrl.searchParams.set('t', String(Date.now()));
          const response = await abortable(fetch(requestUrl.href, networkCameraRequestOptions(signal)), signal);
          if (signal.aborted) throw signal.reason;
          this.immediateFailures = 0;
          this.diagnostic.phase = 'response';
          if (!response.ok || !response.headers.get('content-type')?.includes('multipart/x-mixed-replace') || !response.body)
            throw new Error(`Camera did not return an MJPEG stream. HTTP ${response.status}; Content-Type: ${response.headers.get('content-type') ?? '(missing)'}`);
          const reader = response.body.getReader(); this.reader = reader;
          const parser = new MjpegFrames();
          while (!signal.aborted) {
            this.diagnostic.phase = 'read';
            const { value: chunk, done } = await abortable(reader.read(), signal);
            if (signal.aborted) throw signal.reason;
            if (done) throw new Error('Camera stream ended.');
            this.diagnostic.lastBytesAt = Date.now();
            this.diagnostic.phase = 'parse';
            const bytes = parser.push(chunk).at(-1);
            if (!bytes) continue;
            this.diagnostic.phase = 'decode';
            const previous = this.objectUrl;
            this.objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
            this.ready = false;
            this.image.src = this.objectUrl;
            try { await abortable(this.image.decode(), signal); }
            finally { if (previous) URL.revokeObjectURL(previous); }
            if (signal.aborted) throw signal.reason;
            if (!this.image.naturalWidth || !this.image.naturalHeight) throw new Error('Empty camera image.');
            this.lastNetworkFrameAt = Date.now();
            this.diagnostic.lastFrameAt = this.lastNetworkFrameAt;
            this.diagnostic.frames++; this.frameVersion++;
            this.width = this.image.naturalWidth; this.height = this.image.naturalHeight;
            this.ready = true;
            this.diagnostic.status = 'Connected'; this.diagnostic.stream = 'Healthy';
            this.diagnostic.browserWarning = undefined;
            watchdog();
            if (!opened) {
              opened = true;
              this.diagnostic.connectedAt = this.lastNetworkFrameAt;
              this.log('network stream opened');
              if (retry) { this.diagnostic.reconnectResult = 'success'; this.log('reconnect successful'); }
              this.diagnostic.reconnectAttempts = 0;
              this.rejectConnection = undefined;
              resolve(); recovered();
            }
            if (this.lastNetworkFrameAt - this.lastFrameLog >= 5000) {
              this.lastFrameLog = this.lastNetworkFrameAt; this.log('frame received');
            }
          }
        } catch (error) {
          if (this.stopped || this.controller !== controller) return;
          const immediateFetchFailure = this.diagnostic.phase === 'request' && !timedOut &&
            error instanceof TypeError && performance.now() - requestedAt <= NETWORK_IMMEDIATE_FAILURE_MS;
          this.immediateFailures = immediateFetchFailure ? this.immediateFailures + 1 : 0;
          const retryLimitReached = this.immediateFailures >= NETWORK_FETCH_FAILURE_LIMIT;
          this.diagnostic.status = 'Error'; this.diagnostic.stream = 'Stalled';
          this.diagnostic.lastError = { at: Date.now(), phase: this.diagnostic.phase,
            category: networkCameraFailureCategory(error, this.diagnostic.phase, timedOut),
            reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
          this.log(timedOut ? 'stream stalled' : 'stream error', error);
          if (retry && !opened) { this.diagnostic.reconnectResult = 'failure'; this.log('reconnect failed', error); }
          this.log('closing stale stream');
          this.closeTransport();
          if (retryLimitReached) {
            this.diagnostic.stream = 'Stopped';
            this.diagnostic.browserWarning = NETWORK_BROWSER_GUIDANCE;
            this.log('automatic retries stopped after repeated immediate fetch failures', error);
          }
          // Existing camera-loss callback pauses rule/Follow control before recovery can start.
          ended();
          if (this.stopped) return;
          if (retryLimitReached) {
            this.rejectConnection?.(new Error(NETWORK_BROWSER_GUIDANCE, { cause: error }));
            this.rejectConnection = undefined;
            return;
          }
          this.diagnostic.stream = 'Reconnecting';
          const delay = NETWORK_RETRY_DELAYS_MS[Math.min(this.diagnostic.reconnectAttempts, NETWORK_RETRY_DELAYS_MS.length - 1)];
          this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void attempt(true); }, delay);
        }
      };
      void attempt(false);
    });
  }
}
