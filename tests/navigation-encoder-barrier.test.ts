import { expect, it } from 'vitest';
import { NavigationEncoderBarrier } from '../src/core/NavigationEncoderBarrier';
import type { SensorState } from '../src/core/Sensors';
it('rejects age-valid pre-STOP baselines and waits for BOTH post-STOP encoder readings', async () => {
 let now=100, state: SensorState={finchEncoderLeft:{reading:{kind:'number',value:1},updatedAt:90},finchEncoderRight:{reading:{kind:'number',value:1.3},updatedAt:95}};
 const barrier=new NavigationEncoderBarrier(()=>state,()=>now); let ready=false;
 const waiting=barrier.wait(100,new AbortController().signal).then(()=>{ready=true;});
 await Promise.resolve(); expect(ready).toBe(false);
 now=110;state.finchEncoderLeft={reading:{kind:'number',value:1.4},updatedAt:110};barrier.sensorsUpdated();
 await Promise.resolve(); expect(ready).toBe(false);
 now=120;state.finchEncoderRight={reading:{kind:'number',value:1.5},updatedAt:120};barrier.sensorsUpdated();
 await waiting;expect(ready).toBe(true);
});
it('global cancellation interrupts the baseline wait', async () => {
 const abort=new AbortController(),barrier=new NavigationEncoderBarrier(()=>({}));
 const waiting=barrier.wait(performance.now(),abort.signal);
 abort.abort();await expect(waiting).rejects.toThrow('cancelled');
});
it('missing fresh encoder pair times out with an exact reason', async () => {
 const barrier=new NavigationEncoderBarrier(()=>({}),()=>100,10);
 await expect(barrier.wait(100,new AbortController().signal)).rejects.toThrow('no new pair after STOP');
});
