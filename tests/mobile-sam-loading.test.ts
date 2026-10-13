import { afterEach, expect, it, vi } from 'vitest';
import { MobileSAMSegmenter } from '../src/core/MobileSAMSegmenter';
class WorkerFixture {
  static instances: WorkerFixture[] = [];
  messages: any[] = []; onmessage?: (event: any) => void; terminated = false;
  constructor() { WorkerFixture.instances.push(this); }
  postMessage(message: any) { this.messages.push(message); }
  reply(result: unknown = true) { this.onmessage?.({data:{result}}); }
  fail() { this.onmessage?.({data:{error:'model unavailable'}}); }
  terminate() { this.terminated = true; }
}
const services: MobileSAMSegmenter[] = [];
function setup() {
  WorkerFixture.instances = [];
  vi.stubGlobal('Worker', WorkerFixture); vi.stubGlobal('document', {baseURI:'http://localhost/'});
  const sam = new MobileSAMSegmenter(); services.push(sam); return sam;
}
afterEach(() => { services.splice(0).forEach(s => s.dispose());vi.unstubAllGlobals(); });
it('deduplicates concurrent initialization and retains ready model sessions', async () => {
  const sam=setup(),first=sam.load(),second=sam.load(); expect(first).toBe(second);
  await vi.waitFor(() => expect(WorkerFixture.instances).toHaveLength(1));
  const worker=WorkerFixture.instances[0];expect(worker.messages.map(m=>m.kind)).toEqual(['load']);
  worker.reply();await Promise.all([first,second]);expect(sam.ready).toBe(true);
  await sam.load();expect(worker.messages).toHaveLength(1);
});
it('clears an obsolete embedding after pending inference without terminating or reloading', async () => {
  const sam=setup(),load=sam.load();await vi.waitFor(()=>expect(WorkerFixture.instances).toHaveLength(1));
  const worker=WorkerFixture.instances[0];worker.reply();await load;
  vi.stubGlobal('createImageBitmap',async()=>({close:vi.fn()}));
  const capture=sam.capture({} as HTMLCanvasElement);await vi.waitFor(()=>expect(worker.messages.at(-1).kind).toBe('encode'));
  const clear=sam.clear();expect(worker.messages.at(-1).kind).toBe('encode');
  worker.reply();await capture;await vi.waitFor(()=>expect(worker.messages.at(-1).kind).toBe('clear'));
  worker.reply();await clear;await sam.load();expect(worker.terminated).toBe(false);
  expect(worker.messages.filter(m=>m.kind==='load')).toHaveLength(1);
});
it('allows retry after an actual loading failure', async () => {
  const sam=setup(),load=sam.load();const rejected=expect(load).rejects.toThrow('model unavailable');
  await vi.waitFor(()=>expect(WorkerFixture.instances).toHaveLength(1));const worker=WorkerFixture.instances[0];worker.fail();await rejected;
  expect(sam.ready).toBe(false);const retry=sam.load();await vi.waitFor(()=>expect(worker.messages).toHaveLength(2));worker.reply();await retry;expect(sam.ready).toBe(true);
});
it('fatal disposal cancels pending and queued work without restarting a worker', async () => {
  const sam=setup(),load=sam.load();const rejected=expect(load).rejects.toThrow('test abort');
  await vi.waitFor(()=>expect(WorkerFixture.instances).toHaveLength(1));sam.dispose('test abort');await rejected;
  expect(WorkerFixture.instances[0].terminated).toBe(true);expect(sam.ready).toBe(false);
});
it('shares a lazy service across UI panel lifetimes without starting a worker until load', async () => {
  setup();vi.resetModules();const {mobileSAMService}=await import('../src/core/MobileSAMService');
  const first=mobileSAMService(),second=mobileSAMService();expect(first).toBe(second);
  const sam=await first;services.push(sam);expect(WorkerFixture.instances).toHaveLength(0);
  const load=sam.load();await vi.waitFor(()=>expect(WorkerFixture.instances).toHaveLength(1));WorkerFixture.instances[0].reply();await load;
  expect(await mobileSAMService()).toBe(sam);await sam.load();expect(WorkerFixture.instances).toHaveLength(1);
});
