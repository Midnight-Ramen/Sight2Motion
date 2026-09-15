/** Desktop BlueBird HTTP API. No camera data or remote host is accepted here. */
export class BirdBrainTransport {
  static readonly origin = 'http://127.0.0.1:30061';
  private pending = new Set<AbortController>();
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async request(path: string, signal?: AbortSignal, emergency = false): Promise<string> {
    if (!path.startsWith('/hummingbird/')) throw new Error('Unsupported BirdBrain route.');
    const controller = new AbortController();
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (!emergency && path.startsWith('/hummingbird/out/')) this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), emergency ? 1500 : 2000);
    try {
      const response = await this.fetcher(BirdBrainTransport.origin + path, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        keepalive: emergency,
      });
      if (!response.ok) throw new Error('BlueBird did not accept the request.');
      return (await response.text()).trim();
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      throw new Error(
        'Cannot reach BlueBird Connector. Check that BlueBird and this local app server are running. ' + (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      this.pending.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
  cancelPending() {
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  async command(path: string, signal?: AbortSignal, emergency = false) {
    const result = await this.request(path, signal, emergency);
    // Desktop servlet returns a text "200" even though the HTTP status is already 200.
    if (result !== '200')
      throw new Error(
        result === 'Not Connected'
          ? 'Robot is disconnected in BlueBird.'
          : 'BlueBird returned an unexpected command response.',
      );
  }
}


