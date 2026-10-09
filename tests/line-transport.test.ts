import {expect,it} from 'vitest';
import {BirdBrainTransport} from '../src/core/BirdBrainTransport';
it('line sampling serializes input and motor requests and restores ordinary mode',async()=>{
 let active=0,max=0;const releases:Array<()=>void>=[];
 const transport=new BirdBrainTransport((async()=>{active++;max=Math.max(max,active);await new Promise<void>(r=>releases.push(r));active--;return new Response('200');}) as typeof fetch);
 transport.setLineSampling(true);
 const left=transport.request('/hummingbird/in/Line/Left/A'),right=transport.request('/hummingbird/in/Line/Right/A'),wheel=transport.request('/hummingbird/out/wheels/A/20/0/');
 await new Promise(r=>setTimeout(r,0));expect(active).toBe(1);releases.shift()!();await left;
 await new Promise(r=>setTimeout(r,0));expect(active).toBe(1);releases.shift()!();await right;
 await new Promise(r=>setTimeout(r,0));releases.shift()!();await wheel;expect(max).toBe(1);
 transport.setLineSampling(false);const a=transport.request('/hummingbird/in/Line/Left/A'),b=transport.request('/hummingbird/in/Line/Right/A');
 await new Promise(r=>setTimeout(r,0));expect(active).toBe(2);releases.splice(0).forEach(r=>r());await Promise.all([a,b]);
});
