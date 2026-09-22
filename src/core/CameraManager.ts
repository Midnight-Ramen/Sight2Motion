import { NetworkCameraSource } from './NetworkCameraSource';
import type { CameraFrame } from './VisionProvider';

export class LocalCameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private generation = 0;
  get frame(): CameraFrame | null {
    return this.stream && this.video && this.video.readyState >= 2 && this.video.videoWidth > 0 ? this.video : null;
  }
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
  private local = new LocalCameraSource();
  private network?: NetworkCameraSource;
  private generation = 0;
  get frame(): CameraFrame | null { return this.network ? this.network.frame : this.local.frame; }
  get width() { const f = this.frame; return this.network?.width ?? (f ? ('videoWidth' in f ? f.videoWidth : 'naturalWidth' in f ? f.naturalWidth : f.width) : 0); }
  get height() { const f = this.frame; return this.network?.height ?? (f ? ('videoHeight' in f ? f.videoHeight : 'naturalHeight' in f ? f.naturalHeight : f.height) : 0); }
  connect(video: HTMLVideoElement, deviceId?: string) {
    this.stop();
    return this.local.connect(video, deviceId);
  }
  connectNetwork(image: HTMLImageElement, url: string, ended: () => void) {
    this.stop();
    const generation = this.generation;
    this.network = new NetworkCameraSource(image);
    return this.network.connect(url, () => { if (generation === this.generation) ended(); });
  }
  onEnded(callback: () => void) { this.local.onEnded(callback); }
  stop() {
    ++this.generation;
    this.local.stop();
    this.network?.stop();
    this.network = undefined;
  }
}
