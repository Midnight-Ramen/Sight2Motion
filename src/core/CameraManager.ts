export class CameraManager {
  private stream: MediaStream | null = null;
  async connect(video: HTMLVideoElement, deviceId?: string) {
    this.stop();
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
    this.stream = stream;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      this.stop();
      throw new Error('Camera could not start. Try connecting again.');
    }
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
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
