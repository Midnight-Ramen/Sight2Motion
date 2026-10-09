import { expect,it,vi,afterEach } from 'vitest';
import {SensorProvider} from '../src/core/SensorProvider';
import {finchSensorDescriptor} from '../src/core/Sensors';
afterEach(()=>vi.useRealTimers());
it('prioritizes consecutive L/R reads in one loop and restores normal cadence',async()=>{
 vi.useFakeTimers();const ids:string[]=[];let concurrent=0,max=0;
 const p=new SensorProvider(async s=>{concurrent++;max=Math.max(max,concurrent);ids.push(s.id);await Promise.resolve();concurrent--;return {kind:'number',value:99};});
 const types=['finchEncoderLeft','finchEncoderRight','finchDistance','finchLineLeft','finchLineRight'] as const;
 p.start(types.map(finchSensorDescriptor),()=>{});
 await vi.advanceTimersByTimeAsync(500);expect(ids.slice(0,5)).toEqual(types);
 p.setPriority(['finchLineLeft','finchLineRight']);ids.length=0;
 await vi.advanceTimersByTimeAsync(310);
 expect(ids.slice(0,6)).toEqual(['finchLineLeft','finchLineRight','finchLineLeft','finchLineRight','finchLineLeft','finchLineRight']);
 expect(max).toBe(1);
 p.setPriority([]);await vi.advanceTimersByTimeAsync(100);ids.length=0;
 await vi.advanceTimersByTimeAsync(500);expect(ids.length).toBe(5);
 p.stop();ids.length=0;await vi.advanceTimersByTimeAsync(500);expect(ids).toEqual([]);
});

it('priority reads wait for transport, publish paired data, and stop cleanly',async()=>{
 vi.useFakeTimers();let active=0,max=0;const times:number[]=[];const snapshots:string[][]=[];
 const p=new SensorProvider(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return {kind:'number',value:99};});
 p.start(['finchLineLeft','finchLineRight'].map(id=>finchSensorDescriptor(id as 'finchLineLeft'|'finchLineRight')),s=>{if(s.finchLineRight){times.push(performance.now());snapshots.push(Object.keys(s));}});
 p.setPriority(['finchLineLeft','finchLineRight']);
 await vi.advanceTimersByTimeAsync(400);
 expect(max).toBe(1);expect(snapshots.length).toBeGreaterThan(4);
 expect(snapshots.every(s=>s.includes('finchLineLeft')&&s.includes('finchLineRight'))).toBe(true);
 const count=snapshots.length;p.stop();await vi.advanceTimersByTimeAsync(300);expect(snapshots).toHaveLength(count);
});
it('awaits the pair consumer before the next read and budgets a 20 ms cycle',async()=>{
 vi.useFakeTimers();const events:string[]=[];const starts:number[]=[];
 const p=new SensorProvider(async s=>{events.push(s.id);if(s.id==='finchLineLeft')starts.push(Date.now());await new Promise(r=>setTimeout(r,3));return {kind:'number',value:99};});
 p.start(['finchLineLeft','finchLineRight'].map(id=>finchSensorDescriptor(id as 'finchLineLeft'|'finchLineRight')),()=>{});
 p.setPriority(['finchLineLeft','finchLineRight'],async()=>{events.push('command');await new Promise(r=>setTimeout(r,4));events.push('command complete');});
 await vi.advanceTimersByTimeAsync(220);
 expect(events.join(',')).toContain('finchLineLeft,finchLineRight,command,command complete,finchLineLeft');
 const deltas=starts.slice(3).map((t,i)=>t-starts[i+2]);expect(deltas.every(t=>t>=20&&t<=25)).toBe(true);
 p.stop();
});
it('priority cycle can include turn encoders then return to L/R-only without generic polling',async()=>{
 vi.useFakeTimers();const ids:string[]=[];const p=new SensorProvider(async s=>{ids.push(s.id);return {kind:'number',value:99};});
 const all=['finchLineLeft','finchLineRight','finchEncoderLeft','finchEncoderRight','finchDistance'] as const;
 p.start(all.map(finchSensorDescriptor),()=>{});p.setPriority(all.slice(0,4));await vi.advanceTimersByTimeAsync(180);
 expect(ids).toContain('finchEncoderRight');expect(ids).not.toContain('finchDistance');
 p.setPriority(all.slice(0,2));await vi.advanceTimersByTimeAsync(40);ids.length=0;await vi.advanceTimersByTimeAsync(100);
 expect(ids.length).toBeGreaterThan(4);expect(ids.every(id=>id==='finchLineLeft'||id==='finchLineRight')).toBe(true);p.stop();
});
