import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CameraManager } from '../src/core/CameraManager';
import { NETWORK_FRAME_TIMEOUT_MS, networkCameraRequestOptions } from '../src/core/NetworkCameraSource';
import { ActionEngine } from '../src/core/ActionEngine';
import { makeAction, makeRule, type Detection } from '../src/core/types';
import { MockRobotAdapter } from './MockRobotAdapter';

const part = new Uint8Array([...new TextEncoder().encode('--cam\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\n'),255,216,255,217,13,10]);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let manager: CameraManager, img: HTMLImageElement;
let clients: { url: string; signal: AbortSignal; stream: ReadableStreamDefaultController<Uint8Array> }[];
beforeEach(() => {
  vi.useFakeTimers(); clients = []; manager = new CameraManager();
  img = { src:'',naturalWidth:640,naturalHeight:480,decode:vi.fn().mockResolvedValue(undefined),
    removeAttribute:vi.fn(() => { img.src=''; }) } as unknown as HTMLImageElement;
  vi.spyOn(console,'info').mockImplementation(() => {}); vi.spyOn(console,'warn').mockImplementation(() => {});
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:frame'); vi.spyOn(URL,'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch',vi.fn((url: string, {signal}: {signal:AbortSignal}) => {
    expect(clients.filter(c => !c.signal.aborted)).toHaveLength(0);
    expect(img.src).toBe(''); // Previous image and transport released before every new request.
    const body = new ReadableStream<Uint8Array>({start(stream) {
      clients.push({url,signal,stream});
      signal.addEventListener('abort',() => stream.error(signal.reason),{once:true});
    }});
    return Promise.resolve(new Response(body,{headers:{'content-type':'multipart/x-mixed-replace; boundary=cam'}}));
  }));
});
afterEach(async () => { manager.stop(); await flush(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function start(ended = vi.fn(), recovered = vi.fn()) {
  const pending = manager.connectNetwork(img,'http://camera/stream?quality=12',ended,recovered);
  await flush(); clients.at(-1)!.stream.enqueue(part); await pending;
  return {ended,recovered};
}
it('adds local address space only when Request exposes the capability, retaining fetch safeguards', () => {
  const signal = new AbortController().signal;
  class UnsupportedRequest {}
  vi.stubGlobal('Request', UnsupportedRequest);
  expect(networkCameraRequestOptions(signal)).toEqual({signal,mode:'cors',cache:'no-store',credentials:'omit'});
  class SupportedRequest { get targetAddressSpace() { return 'local'; } }
  vi.stubGlobal('Request', SupportedRequest);
  expect(networkCameraRequestOptions(signal)).toEqual({signal,mode:'cors',cache:'no-store',credentials:'omit',targetAddressSpace:'local'});
});
it('incoming identical frames keep health stable with no inference or render consumer', async () => {
  await start();
  for (let i=0;i<8;i++) {
    await vi.advanceTimersByTimeAsync(1900);
    expect(manager.networkHealthy).toBe(true);
    clients[0].stream.enqueue(part); await flush();
    expect(manager.networkDiagnostics.lastFrameAt).toBe(Date.now());
    expect(vi.getTimerCount()).toBe(1);
  }
  expect(fetch).toHaveBeenCalledOnce(); expect(manager.frame).toBe(img);
});
it('a 2 second stall closes the old client and schedules exactly one cache-busted retry', async () => {
  const {ended,recovered} = await start();
  await vi.advanceTimersByTimeAsync(1999); expect(manager.networkHealthy).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(NETWORK_FRAME_TIMEOUT_MS).toBe(2000); expect(ended).toHaveBeenCalledOnce();
  expect(manager.frame).toBeNull(); expect(img.src).toBe(''); expect(clients[0].signal.aborted).toBe(true);
  expect(manager.networkDiagnostics.stream).toBe('Reconnecting'); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
  const url = new URL(clients[1].url);
  expect(url.searchParams.get('quality')).toBe('12'); expect(url.searchParams.get('t')).toBe(String(Date.now()));
  clients[1].stream.enqueue(part); await flush();
  expect(recovered).toHaveBeenCalledTimes(2);
  expect(manager.networkDiagnostics).toMatchObject({status:'Connected',stream:'Healthy',reconnectAttempts:0,reconnectResult:'success'});
  expect(vi.getTimerCount()).toBe(1);
});
it('failed retries use 1, 2, 4, 4 second delays and success resets backoff', async () => {
  await start(); clients[0].stream.close(); await flush();
  for (const delay of [1000,2000,4000,4000]) {
    const count=clients.length;
    await vi.advanceTimersByTimeAsync(delay-1); expect(clients).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1); expect(clients).toHaveLength(count+1);
    if (delay === 4000 && count === 4) break;
    clients.at(-1)!.stream.close(); await flush(); expect(vi.getTimerCount()).toBe(1);
  }
  clients.at(-1)!.stream.enqueue(part); await flush();
  expect(manager.networkDiagnostics.reconnectAttempts).toBe(0);
  clients.at(-1)!.stream.close(); await flush();
  const count=clients.length; await vi.advanceTimersByTimeAsync(1000); expect(clients).toHaveLength(count+1);
});
it('manual disconnect cancels retries and ignores an old decode completing later', async () => {
  let decode!: () => void;
  vi.mocked(img.decode).mockImplementationOnce(() => new Promise<void>(resolve => {decode=resolve;}));
  const pending = manager.connectNetwork(img,'http://camera/stream',vi.fn());
  const cancelled=expect(pending).rejects.toThrow('stopped');
  await flush(); clients[0].stream.enqueue(part); await flush();
  await vi.advanceTimersByTimeAsync(2000); expect(manager.networkDiagnostics.stream).toBe('Reconnecting');
  manager.stop(); decode(); await cancelled; await vi.advanceTimersByTimeAsync(20000);
  expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  expect(manager.networkDiagnostics.status).toBe('Disconnected'); expect(manager.frame).toBeNull();
});
it('a hung decoder is aborted and a new connection recovers without waiting for it', async () => {
  await start(); vi.mocked(img.decode).mockImplementationOnce(() => new Promise<void>(() => {}));
  clients[0].stream.enqueue(part); await flush();
  await vi.advanceTimersByTimeAsync(3000); expect(clients).toHaveLength(2);
  clients[1].stream.enqueue(part); await flush();
  expect(manager.networkHealthy).toBe(true); expect(manager.frame).toBe(img);
});
it('changing to laptop cancels pending network recovery', async () => {
  await start(); clients[0].stream.close(); await flush();
  const track={stop:vi.fn()};
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async () => ({getTracks:()=>[track]}),enumerateDevices:async () => []}});
  await manager.connect({srcObject:null,play:async () => {}} as unknown as HTMLVideoElement);
  await vi.advanceTimersByTimeAsync(20000); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
class Wheels extends MockRobotAdapter {
  setWheelSpeeds=vi.fn(async (left:number,right:number) => {this.state.left=left;this.state.right=right;});
}
it.each(['stall', 'error'])('camera %s invokes existing STOP and recovering frames never restore motor commands', async cause => {
  const robot=new Wheels(); await robot.connect(); const engine=new ActionEngine(robot);
  const action={...makeAction('move'),mode:'follow' as const,lostTargetTimeoutMs:5000};
  const rule={...makeRule(),actions:[action]};
  const detection:Detection={className:'person',confidence:.9,x:256,y:96,width:128,height:96,centerX:320,centerY:144};
  const stopped=vi.fn(() => {void engine.stop();});
  await start(stopped);
  await engine.updateRules([rule],[rule],{detections:[detection],width:640,height:480,capturedAt:performance.now()});
  await vi.advanceTimersByTimeAsync(300);
  await engine.updateRules([], [rule], {detections:[detection],width:640,height:480,capturedAt:performance.now()});
  await vi.advanceTimersByTimeAsync(100);
  clients[0].stream.enqueue(part); await flush();
  expect(robot.state.left).toBeGreaterThan(0);
  if (cause === 'stall') {
    await vi.advanceTimersByTimeAsync(1999); expect(stopped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
  } else { clients[0].stream.close(); await flush(); }
  expect(stopped).toHaveBeenCalledOnce(); expect(robot.state.left).toBe(0); expect(robot.state.right).toBe(0);
  const commands=robot.setWheelSpeeds.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000); clients[1].stream.enqueue(part); await flush();
  await vi.advanceTimersByTimeAsync(500);
  expect(manager.networkHealthy).toBe(true); expect(engine.activeMotorOwnerRuleId).toBeNull();
  expect(robot.setWheelSpeeds).toHaveBeenCalledTimes(commands); await engine.stop();
});
it('app uses stream health for network guidance and keeps recovery separate from Play', () => {
  const app=readFileSync('src/App.tsx','utf8');
  expect(app).toContain("cameraSource === 'network' ? camera.networkHealthy");
  const connection=app.slice(app.indexOf('async function connectCamera'),app.indexOf('function disconnectCamera'));
  expect(connection).toContain('setCameraOn(false); pause(); consume([])');
  expect(connection).not.toContain('setAi(true)');
  expect(connection).not.toContain('updateRules(');
});

it('stops after three immediate pre-response fetch failures and allows manual recovery', async () => {
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  const error = new TypeError('Failed to fetch');
  vi.mocked(fetch).mockRejectedValue(error);
  const ended = vi.fn();
  const pending = manager.connectNetwork(img,'http://camera/stream',ended);
  const failed = expect(pending).rejects.toThrow('Try allowing Local Network Access or use Chrome');
  await flush(); await vi.advanceTimersByTimeAsync(3000); await failed;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(manager.networkDiagnostics).toMatchObject({status:'Error',stream:'Stopped',lastError:{reason:'TypeError: Failed to fetch'}});
  expect(manager.networkDiagnostics.browserWarning).not.toContain('permission denied');
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(30000); expect(fetch).toHaveBeenCalledTimes(3);
  vi.mocked(fetch).mockImplementation(normalFetch);
  const retry = manager.connectNetwork(img,'http://camera/stream',ended);
  await flush(); clients.at(-1)!.stream.enqueue(part); await retry;
  expect(manager.networkDiagnostics).toMatchObject({status:'Connected',stream:'Healthy',reconnectAttempts:0,browserWarning:undefined});
});
it('caps immediate browser failures even after an earlier healthy stream', async () => {
  await start();
  vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
  clients[0].stream.close(); await flush();
  await vi.advanceTimersByTimeAsync(7000);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(manager.networkDiagnostics.stream).toBe('Stopped');
  expect(manager.networkDiagnostics.browserWarning).toContain('could not reach');
  expect(vi.getTimerCount()).toBe(0);
});
it('a successful response resets the immediate-failure streak and normal streaming remains healthy', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const pending=manager.connectNetwork(img,'http://camera/stream',vi.fn());
  await flush(); await vi.advanceTimersByTimeAsync(1000);
  clients.at(-1)!.stream.enqueue(part); await pending;
  expect(manager.networkDiagnostics).toMatchObject({status:'Connected',stream:'Healthy',reconnectAttempts:0,browserWarning:undefined});
  expect(Date.now()-manager.networkDiagnostics.lastFrameAt!).toBe(0);
});
