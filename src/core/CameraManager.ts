import { NetworkCameraSource, createNetworkCameraDiagnostics, networkCameraUrl } from './NetworkCameraSource';
import type { CameraFrame } from './VisionProvider';

export class LocalCameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private generation = 0;
  get frame(): CameraFrame | null {
    return this.stream && this.video && this.video.readyState >= 2 && this.video.videoWidth > 0 ? this.video : null;
  }
  get frameVersion() { return this.video?.getVideoPlaybackQuality().totalVideoFrames ?? 0; }
  async connect(video: HTMLVideoElement, deviceId?: string) {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Open this app on localhost or HTTPS to use your camera.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Camera connection cancelled.');
    }
    this.stream = stream;
    this.video = video;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      if (generation === this.generation) this.stop();
      throw new Error('Camera could not start. Try connecting again.');
    }
    if (generation !== this.generation) throw new Error('Camera connection cancelled.');
    return navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => devices.filter((d) => d.kind === 'videoinput'));
  }
  onEnded(callback: () => void) {
    this.stream
      ?.getVideoTracks()
      .forEach((track) => track.addEventListener('ended', callback, { once: true }));
  }
  stop() {
    ++this.generation;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
}

export class CameraManager {
  private connecting?: { source: object; key: string; promise: Promise<unknown> };
  private trackConnection<T>(source: object, key: string, promise: Promise<T>): Promise<T> {
    const connection = { source, key, promise };
    this.connecting = connection;
    const clear = () => { if (this.connecting === connection) this.connecting = undefined; };
    void promise.then(clear, clear);
    return promise;
  }
  private local = new LocalCameraSource();
  private network?: NetworkCameraSource;
  private networkStats = createNetworkCameraDiagnostics();
  get networkDiagnostics() {
    return { ...this.networkStats, lastError: this.networkStats.lastError ? { ...this.networkStats.lastError } : undefined };
  }
  get networkHealthy() { return this.network?.healthy ?? false; }
  private generation = 0;
  get frame(): CameraFrame | null { return this.network ? this.network.frame : this.local.frame; }
  get frameVersion() { return this.network ? this.network.frameVersion : this.local.frameVersion; }
  get width() { const f = this.frame; return this.network?.width ?? (f ? ('videoWidth' in f ? f.videoWidth : 'naturalWidth' in f ? f.naturalWidth : f.width) : 0); }
  get height() { const f = this.frame; return this.network?.height ?? (f ? ('videoHeight' in f ? f.videoHeight : 'naturalHeight' in f ? f.naturalHeight : f.height) : 0); }
  connect(video: HTMLVideoElement, deviceId?: string) {
    if (this.connecting?.source === video && this.connecting.key === (deviceId ?? ''))
      return this.connecting.promise as Promise<MediaDeviceInfo[]>;
    this.stop('replacement');
    return this.trackConnection(video, deviceId ?? '', this.local.connect(video, deviceId));
  }
  connectNetwork(image: HTMLImageElement, url: string, ended: () => void, recovered?: () => void) {
    if (this.connecting?.source === image && this.connecting.key === url)
      return this.connecting.promise as Promise<void>;
    this.stop('replacement');
    const generation = this.generation;
    if (this.networkStats.url !== networkCameraUrl(url)) this.networkStats = createNetworkCameraDiagnostics();
    this.network = new NetworkCameraSource(image, this.networkStats);
    return this.trackConnection(image, url, this.network.connect(url,
      () => { if (generation === this.generation) ended(); },
      () => { if (generation === this.generation) recovered?.(); }));
  }
  onEnded(callback: () => void) { this.local.onEnded(callback); }
  stop(reason: 'manual' | 'replacement' = 'manual') {
    this.connecting = undefined;
    ++this.generation;
    this.local.stop();
    this.network?.stop(reason);
    this.network = undefined;
  }
}
