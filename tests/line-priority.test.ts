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
 expect(ids.slice(0,6)).toEqual(['finchLineLeft','finchLineRight','finchEncoderLeft','finchLineLeft','finchLineRight','finchEncoderRight']);
 expect(max).toBe(1);
 p.setPriority([]);await vi.advanceTimersByTimeAsync(100);ids.length=0;
 await vi.advanceTimersByTimeAsync(500);expect(ids.length).toBe(5);
 p.stop();ids.length=0;await vi.advanceTimersByTimeAsync(500);expect(ids).toEqual([]);
});
