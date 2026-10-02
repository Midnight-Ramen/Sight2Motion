import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraManager } from '../src/core/CameraManager';
import { MjpegFrames, NetworkCameraSource, networkCameraFailureCategory } from '../src/core/NetworkCameraSource';
import { makeProject } from '../src/core/types';
import { parseProject, ProjectStorage } from '../src/core/ProjectStorage';

const part = new Uint8Array([...new TextEncoder().encode('--camframe\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\n'),255,216,255,217,13,10]);
let stream: ReadableStreamDefaultController<Uint8Array>;
let aborted: boolean;
const image = () => ({ naturalWidth:640, naturalHeight:480, src:'', decode:vi.fn().mockResolvedValue(undefined), removeAttribute:vi.fn() }) as unknown as HTMLImageElement;
const flush = async () => { for(let i=0;i<15;i++) await Promise.resolve(); };
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  aborted = false;
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((_url, options) => {
    const body = new ReadableStream<Uint8Array>({ start(c) { stream=c; } });
    options.signal.addEventListener('abort', () => { aborted=true; try {stream.error(new Error('aborted'));} catch {} });
    return Promise.resolve(new Response(body,{headers:{'content-type':'multipart/x-mixed-replace; boundary=camframe'}}));
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('duplicate network Connect shares one pending client', async () => {
  const manager = new CameraManager(), img = image(), ended = vi.fn();
  const first = manager.connectNetwork(img, 'http://camera/stream', ended);
  const second = manager.connectNetwork(img, 'http://camera/stream', ended);
  expect(second).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  await flush(); stream.enqueue(part); await first;
  manager.stop(); await flush(); expect(ended).not.toHaveBeenCalled();
});
it('duplicate laptop Connect shares one permission request', async () => {
  let grant!: (value: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
  const manager = new CameraManager();
  const video = { srcObject: null, play: async () => {} } as unknown as HTMLVideoElement;
  const first = manager.connect(video), second = manager.connect(video);
  expect(second).toBe(first); expect(getUserMedia).toHaveBeenCalledTimes(1);
  const stop = vi.fn(); grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await first; manager.stop(); expect(stop).toHaveBeenCalledOnce();
});
it('legacy projects default to local and camera fields survive save/load', () => {
  const p=makeProject(); delete p.cameraSource;
  expect(parseProject(JSON.stringify(p)).cameraSource).toBe('local');
  p.cameraSource='network'; p.networkCameraUrl='http://10.0.5.11/stream';
  let saved=''; vi.stubGlobal('localStorage',{getItem:()=>saved || null,setItem:(_k:string,v:string)=>saved=v});
  const storage=new ProjectStorage(); storage.save(p);
  expect(storage.list()[0]).toMatchObject({cameraSource:'network',networkCameraUrl:p.networkCameraUrl});
  expect(parseProject(JSON.stringify(storage.list()[0]))).toEqual(storage.list()[0]);
  expect(() => parseProject(JSON.stringify({...p,networkCameraUrl:'javascript:alert(1)'}))).toThrow();
});
it('parses split multipart frames and bounds malformed input', () => {
  const parser=new MjpegFrames();
  expect(parser.push(part.slice(0,20))).toEqual([]);
  expect(parser.push(part.slice(20))).toEqual([new Uint8Array([255,216,255,217])]);
  expect(parser.push(part)).toHaveLength(1);
  expect(() => new MjpegFrames().push(new Uint8Array(9000))).toThrow();
});
it('does not provide frames before decode and disconnect stops processing', async () => {
  const img=image(); const source=new NetworkCameraSource(img);
  const connected=source.connect('http://camera/stream',vi.fn());
  expect(source.frame).toBeNull(); await flush();
  stream.enqueue(part); await connected;
  expect(source.frame).toBe(img);
  source.stop(); expect(source.frame).toBeNull(); expect(aborted).toBe(true);
  await flush(); expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('stalled stream stops frames and reports loss', async () => {
  vi.useFakeTimers(); const ended=vi.fn(); const source=new NetworkCameraSource(image());
  const connected=source.connect('http://camera/stream',ended); await flush(); stream.enqueue(part); await connected;
  await vi.advanceTimersByTimeAsync(2000);
  expect(source.frame).toBeNull(); expect(ended).toHaveBeenCalledOnce();
  expect(source.diagnostics.lastError?.category).toBe('MJPEG stream stalled');
  expect(source.diagnostics.status).toBe('Error');
  source.stop();
});
it('switching releases each source and preserves normal laptop constraints', async () => {
  const stop=vi.fn(); const track={stop,addEventListener:vi.fn()};
  const media={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const getUserMedia=vi.fn().mockResolvedValue(media);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia,enumerateDevices:vi.fn().mockResolvedValue([{kind:'videoinput',deviceId:'laptop'}])}});
  const video={srcObject:null,play:vi.fn().mockResolvedValue(undefined),readyState:2,videoWidth:1280,videoHeight:720} as unknown as HTMLVideoElement;
  const manager=new CameraManager();
  expect(await manager.connect(video,'laptop')).toHaveLength(1);
  expect(getUserMedia).toHaveBeenCalledWith({audio:false,video:{width:{ideal:1280},height:{ideal:720},deviceId:{exact:'laptop'}}});
  expect(manager.frame).toBe(video);
  const connected=manager.connectNetwork(image(),'http://camera/stream',vi.fn());
  expect(stop).toHaveBeenCalledOnce(); expect(video.srcObject).toBeNull(); expect(manager.frame).toBeNull();
  await flush(); stream.enqueue(part); await connected;
  await manager.connect(video); expect(aborted).toBe(true); expect(manager.frame).toBe(video);
  manager.stop(); expect(manager.frame).toBeNull();
});
it('cancels a pending webcam request when switching sources', async () => {
  let grant!: (stream:MediaStream)=>void; const stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(r=>{grant=r;})}});
  const manager=new CameraManager(); const connecting=manager.connect({} as HTMLVideoElement);
  manager.stop(); grant({getTracks:()=>[{stop}]} as unknown as MediaStream);
  await expect(connecting).rejects.toThrow('cancelled'); expect(stop).toHaveBeenCalledOnce();
});
it('waits for the first decoded image, not just received bytes', async () => {
  let decoded!: () => void;
  const img=image(); vi.mocked(img.decode).mockImplementation(()=>new Promise<void>(r=>{decoded=r;}));
  const source=new NetworkCameraSource(img); const connected=source.connect('http://camera/stream',vi.fn());
  await flush(); stream.enqueue(part); await flush(); expect(source.frame).toBeNull();
  decoded(); await connected; expect(source.frame).toBe(img); source.stop(); await flush();
});
it('EOF clears the frame and reports disconnect', async () => {
  const source=new NetworkCameraSource(image()); const ended=vi.fn();
  const connected=source.connect('http://camera/stream',ended); await flush(); stream.enqueue(part); await connected;
  stream.close(); await flush(); expect(source.frame).toBeNull(); expect(ended).toHaveBeenCalledOnce();
  source.stop();
});
it('stopping an old stream cannot clear a new image after its async cleanup', async () => {
  const img=image(); const old=new NetworkCameraSource(img);
  const connected=old.connect('http://camera/stream',vi.fn()); await flush(); stream.enqueue(part); await connected;
  old.stop(); img.src='blob:new'; vi.mocked(img.removeAttribute).mockClear();
  await flush(); expect(img.removeAttribute).not.toHaveBeenCalled(); expect(img.src).toBe('blob:new');
});

it('retains frame evidence across failed and successful automatic reconnects without probes', async () => {
  vi.useFakeTimers();
  const manager = new CameraManager(), img = image(), ended = vi.fn();
  const first = manager.connectNetwork(img, 'http://camera/stream', ended);
  await flush(); stream.enqueue(part); await first;
  const timestamp = manager.networkDiagnostics.lastFrameAt;
  stream.close(); await flush();
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(manager.networkDiagnostics).toMatchObject({lastFrameAt:timestamp,reconnectAttempts:1,reconnectResult:'failure'});
  await vi.advanceTimersByTimeAsync(2000);
  stream.enqueue(part); await flush();
  expect(manager.networkDiagnostics).toMatchObject({status:'Connected',reconnectAttempts:0,reconnectResult:'success',frames:2});
  expect(fetch).toHaveBeenCalledTimes(3);
  manager.stop(); manager.stop(); await flush();
  expect(vi.mocked(console.info).mock.calls.filter(([event]) => event === '[Network Camera] manual disconnect')).toHaveLength(1);
  expect(manager.networkDiagnostics.status).toBe('Disconnected');
});
it('preserves exact decode errors and returns isolated diagnostics', async () => {
  const error = new Error('Decoder rejected JPEG bytes');
  const img = image(); vi.mocked(img.decode).mockRejectedValue(error);
  const source = new NetworkCameraSource(img);
  const pending = source.connect('http://camera/stream',vi.fn());
  const failed = expect(pending).rejects.toThrow('Camera connection stopped');
  await flush(); stream.enqueue(part); await flush();
  expect(source.diagnostics.lastError).toMatchObject({category:'image decode/client failure',reason:'Error: Decoder rejected JPEG bytes',phase:'decode'});
  expect(console.warn).toHaveBeenCalledWith('[Network Camera] stream error',expect.objectContaining({timestamp:expect.any(String)}),error);
  source.diagnostics.lastError!.reason = 'changed';
  expect(source.diagnostics.lastError?.reason).toContain('Decoder rejected');
  source.stop(); await failed;
});
it('does not label opaque browser failures as proven DNS or network failures', () => {
  expect(networkCameraFailureCategory(new TypeError('Failed to fetch'),'request',false)).toContain('unresolved');
  expect(networkCameraFailureCategory(new Error('ERR_NAME_NOT_RESOLVED'),'request',false)).toBe('hostname/mDNS failure');
  expect(networkCameraFailureCategory(new Error('ENETUNREACH'),'request',false)).toBe('network unreachable');
});
it('records every decoded frame but throttles successful-frame console messages', async () => {
  vi.useFakeTimers();
  const source = new NetworkCameraSource(image());
  const pending = source.connect('http://camera/stream',vi.fn());
  await flush(); stream.enqueue(part); await pending;
  await vi.advanceTimersByTimeAsync(1000); stream.enqueue(part); await flush();
  expect(source.diagnostics.frames).toBe(2);
  expect(source.diagnostics.lastFrameAt).toBe(Date.now());
  expect(vi.mocked(console.info).mock.calls.filter(([event]) => event === '[Network Camera] frame received')).toHaveLength(1);
  source.stop(); await flush();
});
