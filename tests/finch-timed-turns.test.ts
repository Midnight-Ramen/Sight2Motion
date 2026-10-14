import {afterEach,expect,it,vi} from 'vitest';
import {FinchAdapter} from '../src/core/FinchAdapter';
import {BirdBrainTransport} from '../src/core/BirdBrainTransport';
import {ActionEngine} from '../src/core/ActionEngine';
import {RuleEngine} from '../src/core/RuleEngine';
import {TM_CAPABILITIES} from '../src/core/VisionCapabilities';
import {makeAction,makeRule,type Rule} from '../src/core/types';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.useRealTimers();vi.restoreAllMocks();});
async function setup() {
 vi.useFakeTimers();vi.spyOn(console,'debug').mockImplementation(()=>{});
 const events:{path:string;at:number}[]=[];let deadline:ReturnType<typeof setTimeout>|undefined;
 const watchdog={arm:vi.fn(async(_slot:string,duration:number)=>{clearTimeout(deadline);deadline=setTimeout(()=>events.push({path:'watchdog STOP',at:performance.now()}),duration);}),disarm:vi.fn(()=>clearTimeout(deadline))};
 const fetcher=vi.fn<typeof fetch>(async url=>{events.push({path:String(url),at:performance.now()});return new Response(String(url).includes('/in/')?'true':'200');});
 const robot=new FinchAdapter(()=>{},new BirdBrainTransport(fetcher),'A',watchdog);await robot.connect();events.length=0;
 const error=vi.fn(),engine=new ActionEngine(robot,()=>{},error);
 cleanup.push(async()=>{await engine.stop();await robot.disconnect();watchdog.disarm();});
 return {robot,engine,events,watchdog,error,fetcher,wheels:()=>events.filter(e=>e.path.includes('/wheels/')),stops:()=>events.filter(e=>/stopFinch|stopall|watchdog STOP/.test(e.path))};
}
const turn=(direction:'left'|'right',duration=1000)=>({...makeAction('move'),mode:'timed' as const,direction,speed:40,duration});
it.each(['left','right'] as const)('Timed %s 1000ms commands the correct signs and STOP only at completion',async direction=>{
 const s=await setup();const task=s.engine.run([turn(direction)]);await vi.advanceTimersByTimeAsync(0);
 expect(s.wheels()).toHaveLength(1);expect(s.wheels()[0].path).toContain(direction==='left'?'/wheels/A/-40/40/':'/wheels/A/40/-40/');
 expect(s.engine.busy).toBe(true);await vi.advanceTimersByTimeAsync(999);expect(s.stops()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);expect(await task).toBe(true);expect(s.stops()).toHaveLength(1);expect(s.stops()[0].at-s.wheels()[0].at).toBe(1000);expect(s.engine.busy).toBe(false);expect(s.error).not.toHaveBeenCalled();
 const renewals=s.watchdog.arm.mock.calls.length;await vi.advanceTimersByTimeAsync(2000);expect(s.watchdog.arm).toHaveBeenCalledTimes(renewals);expect(s.stops()).toHaveLength(1);
});
it.each([500,2000,10000])('40 percent rule turn supports %sms while renewing the existing watchdog',async duration=>{
 const s=await setup();const task=s.engine.run([turn('left',duration)]);await vi.advanceTimersByTimeAsync(duration-1);expect(s.stops()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);expect(await task).toBe(true);expect(s.wheels()).toHaveLength(1);expect(s.stops()).toHaveLength(1);expect(s.watchdog.arm.mock.calls.every(([,ms])=>ms===1000)).toBe(true);
});
it('repeated matching TM frames do not restart or release the active finite turn',async()=>{
 const s=await setup(),rules=new RuleEngine();const rule:Rule={...makeRule(),className:'Turn Left',minDuration:0,cooldown:0,mode:'continuous',actions:[turn('left')]};
 const sample=()=>{const triggered=rules.evaluate([rule],[{className:'Turn Left',confidence:.95}],performance.now(),TM_CAPABILITIES);return s.engine.updateRules(triggered,rules.activeRules);};
 const first=sample();await vi.advanceTimersByTimeAsync(0);
 for(let i=0;i<9;i++){await vi.advanceTimersByTimeAsync(100);expect(await sample()).toBe(false);expect(s.stops()).toHaveLength(0);expect(s.wheels()).toHaveLength(1);}
 await vi.advanceTimersByTimeAsync(100);expect(await first).toBe(true);expect(s.stops()[0].at).toBe(1000);
});
it.each(['global STOP','Space STOP','disconnect','sensor Stop'] as const)('%s interrupts a timed turn immediately',async cause=>{
 const s=await setup();const action=turn('left',2000);const task=s.engine.run([action]);await vi.advanceTimersByTimeAsync(100);
 if(cause==='disconnect')await s.robot.disconnect();
 else if(cause==='sensor Stop'){const rule={...makeRule(),source:'sensor' as const,actions:[makeAction('stop')]};await s.engine.updateRules([rule],[rule]);}
 else await s.engine.stop(); // Space dispatches the same global STOP path.
 expect(await task).toBe(false);expect(s.stops().length).toBeGreaterThan(0);expect(s.stops()[0].at).toBe(100);expect(s.engine.busy).toBe(false);
 const count=s.wheels().length;await vi.advanceTimersByTimeAsync(2500);expect(s.wheels()).toHaveLength(count);
});
it('a cancelled timed turn cannot stop a replacement continuous turn at its old deadline',async()=>{
 const s=await setup();const task=s.engine.run([turn('left',2000)]);await vi.advanceTimersByTimeAsync(100);
 const rule={...makeRule(),actions:[{...turn('right'),mode:'continuous' as const}]};await s.engine.updateRules([rule],[rule]);expect(await task).toBe(false);
 const stops=s.stops().length;await vi.advanceTimersByTimeAsync(2100);expect(s.stops()).toHaveLength(stops);expect(s.wheels().at(-1)?.path).toContain('/40/-40/');expect(s.engine.activeMotorOwnerRuleId).toBe(rule.id);
});
it('watchdog renewal failure aborts timed motion and reports failure',async()=>{
 const s=await setup();const task=s.engine.run([turn('left',2000)]);await vi.advanceTimersByTimeAsync(0);s.watchdog.arm.mockRejectedValueOnce(new Error('worker failure'));
 await vi.advanceTimersByTimeAsync(250);expect(await task).toBe(false);expect(s.robot.connected).toBe(false);expect(s.stops().length).toBeGreaterThan(0);
});
it('zero duration issues no wheel command',async()=>{
 const s=await setup();await s.engine.run([turn('left',0)]);expect(s.wheels()).toHaveLength(0);
});
it('command acknowledgement starts the requested hold duration, not the earlier watchdog arm',async()=>{
 const s=await setup();const normal=s.fetcher.getMockImplementation()!;
 s.fetcher.mockImplementation(async(url,options)=>{if(String(url).includes('/wheels/'))await new Promise(r=>setTimeout(r,400));return normal(url,options);});
 const task=s.engine.run([turn('left',1000)]);await vi.advanceTimersByTimeAsync(1399);expect(s.stops()).toHaveLength(0);await vi.advanceTimersByTimeAsync(1);expect(await task).toBe(true);expect(s.stops()[0].at-s.wheels()[0].at).toBe(1000);
});
